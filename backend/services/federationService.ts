import crypto from 'crypto';

import * as StellarSdk from '@stellar/stellar-sdk';
import axios from 'axios';

import * as cacheService from './cacheService';

export interface VetFederationRecord {
  vetId: string;
  federatedAddress: string; // e.g. dr.smith*petchain.app
  stellarPublicKey: string;
  stellarSecretKey: string; // stored encrypted in prod; plaintext here for demo
  credentialHash: string; // SHA-256 of credential document
  claimedAt: string;
  revokedAt?: string;
}

export interface SignedRecord {
  recordId: string;
  recordHash: string;
  vetFederatedAddress: string;
  vetPublicKey: string;
  signature: string; // hex-encoded Ed25519 signature over recordHash
  signedAt: string;
}

/**
 * Result from resolving a Stellar federation address.
 * `null` indicates the address was not found.
 */
export interface FederationResult {
  stellarAddress: string;
  memo?: string;
  memoType?: string;
}

// In-memory store (replace with DB in production)
const federationRecords = new Map<string, VetFederationRecord>(); // key: federatedAddress
const vetToAddress = new Map<string, string>(); // key: vetId → federatedAddress
const signedRecords = new Map<string, SignedRecord>(); // key: recordId

// ─── Stellar Federation Resolution ──────────────────────────────────────────

const FEDERATION_SERVER_URL =
  process.env.STELLAR_FEDERATION_SERVER || 'https://federation.stellar.org';
const DEFAULT_FEDERATION_TTL = 15 * 60; // 15 minutes in seconds
const NEGATIVE_RESULT_TTL = 2 * 60; // 2 minutes for "not found" results

/**
 * Parses the Cache-Control header and returns the max-age in seconds.
 * Returns `null` if the header is not present or invalid.
 */
function parseCacheControl(cacheControlHeader: string | undefined): number | null {
  if (!cacheControlHeader) return null;

  const maxAgeMatch = cacheControlHeader.match(/max-age=(\d+)/i);
  if (maxAgeMatch && maxAgeMatch[1]) {
    return parseInt(maxAgeMatch[1], 10);
  }

  return null;
}

/**
 * Determines the TTL to use for a federation result.
 * Respects the federation server's Cache-Control header.
 * Uses the lower of server TTL and our default, capped at the default.
 */
function determineTTL(serverCacheControlHeader: string | undefined): number {
  const serverTTL = parseCacheControl(serverCacheControlHeader);

  if (serverTTL !== null && serverTTL > 0) {
    // Use the lower of server TTL and our default
    return Math.min(serverTTL, DEFAULT_FEDERATION_TTL);
  }

  return DEFAULT_FEDERATION_TTL;
}

/**
 * Resolves a Stellar federation address (e.g., user*petchain.app) by querying
 * the federation server. Results are cached with a 15-minute TTL by default.
 *
 * Cache behavior:
 * - Positive results (address found): cached with max-age from Cache-Control or 15 min default
 * - Negative results (address not found): cached for 2 minutes
 * - Returns `null` if the address is not found or if the federation lookup fails
 *
 * @param federationAddress - The federation address to resolve (e.g., "user*petchain.app")
 * @returns The resolved Stellar address and optional memo, or `null` if not found
 */
export async function resolveFederation(
  federationAddress: string,
): Promise<FederationResult | null> {
  const cacheKey = `federation:address:${federationAddress}`;

  // Check cache first
  const cached = await cacheService.get<FederationResult | 'NOT_FOUND'>(cacheKey);
  if (cached !== null) {
    return cached === 'NOT_FOUND' ? null : cached;
  }

  try {
    const url = new URL('/federation', FEDERATION_SERVER_URL);
    url.searchParams.set('q', federationAddress);
    url.searchParams.set('type', 'name');

    const response = await axios.get<FederationResult>(url.toString(), {
      timeout: 5000, // 5 second timeout
    });

    const result = response.data;
    const ttl = determineTTL(response.headers['cache-control']);

    // Cache the positive result
    await cacheService.set(cacheKey, result, ttl);
    return result;
  } catch (error) {
    // On error (including 404), cache a negative result for a short time
    const ttl = NEGATIVE_RESULT_TTL;
    await cacheService.set(cacheKey, 'NOT_FOUND', ttl);
    return null;
  }
}

export function lookupFederation(q: string, type: string): VetFederationRecord | null {
  if (type !== 'name') return null;
  // q is the full federated address e.g. dr.smith*petchain.app
  const record = federationRecords.get(q);
  if (!record || record.revokedAt) return null;
  return record;
}

export function claimFederatedAddress(
  vetId: string,
  username: string, // e.g. "dr.smith"
  credentialHash: string,
): VetFederationRecord {
  const domain = 'petchain.app';
  const federatedAddress = `${username}*${domain}`;

  if (federationRecords.has(federatedAddress)) {
    const existing = federationRecords.get(federatedAddress)!;
    if (existing.vetId !== vetId) {
      throw new Error('Federated address already claimed by another vet');
    }
    if (!existing.revokedAt) {
      throw new Error('Federated address already active');
    }
  }

  const keypair = StellarSdk.Keypair.random();
  const record: VetFederationRecord = {
    vetId,
    federatedAddress,
    stellarPublicKey: keypair.publicKey(),
    stellarSecretKey: keypair.secret(),
    credentialHash,
    claimedAt: new Date().toISOString(),
  };

  federationRecords.set(federatedAddress, record);
  vetToAddress.set(vetId, federatedAddress);
  return record;
}

export function signMedicalRecord(
  recordId: string,
  recordPayload: unknown,
  vetId: string,
): SignedRecord {
  const federatedAddress = vetToAddress.get(vetId);
  if (!federatedAddress) throw new Error('Vet has no federated identity');

  const record = federationRecords.get(federatedAddress);
  if (!record || record.revokedAt) throw new Error('Vet federated identity is revoked or missing');

  const recordHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(recordPayload))
    .digest('hex');

  const keypair = StellarSdk.Keypair.fromSecret(record.stellarSecretKey);
  const signature = keypair.sign(Buffer.from(recordHash, 'hex')).toString('hex');

  const signed: SignedRecord = {
    recordId,
    recordHash,
    vetFederatedAddress: federatedAddress,
    vetPublicKey: record.stellarPublicKey,
    signature,
    signedAt: new Date().toISOString(),
  };

  signedRecords.set(recordId, signed);
  return signed;
}

export function verifyRecordSignature(recordId: string, recordPayload: unknown): boolean {
  const signed = signedRecords.get(recordId);
  if (!signed) return false;

  const recordHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(recordPayload))
    .digest('hex');

  if (recordHash !== signed.recordHash) return false;

  try {
    const keypair = StellarSdk.Keypair.fromPublicKey(signed.vetPublicKey);
    return keypair.verify(Buffer.from(recordHash, 'hex'), Buffer.from(signed.signature, 'hex'));
  } catch {
    return false;
  }
}

export function revokeVetCredential(vetId: string): void {
  const federatedAddress = vetToAddress.get(vetId);
  if (!federatedAddress) throw new Error('Vet has no federated identity');

  const record = federationRecords.get(federatedAddress);
  if (!record) throw new Error('Federation record not found');
  if (record.revokedAt) throw new Error('Already revoked');

  federationRecords.set(federatedAddress, {
    ...record,
    revokedAt: new Date().toISOString(),
  });
}

export function getSignedRecord(recordId: string): SignedRecord | null {
  return signedRecords.get(recordId) ?? null;
}

export function getVetFederationRecord(vetId: string): VetFederationRecord | null {
  const addr = vetToAddress.get(vetId);
  if (!addr) return null;
  return federationRecords.get(addr) ?? null;
}
