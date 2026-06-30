import crypto from 'crypto';

import * as StellarSdk from '@stellar/stellar-sdk';

import { get, set } from './cacheService';

const CACHE_TTL_POSITIVE = 15 * 60; // 15 minutes
const CACHE_TTL_NEGATIVE = 2 * 60; // 2 minutes for negative results

function federationCacheKey(address: string): string {
  return `federation:resolve:${address}`;
}

export interface ResolvedFederationAddress {
  stellar_address: string;
  account_id: string;
  memo_type?: string;
  memo?: string;
}

interface CachedFederationEntry {
  result: ResolvedFederationAddress | null; // null = negative result
}

/**
 * Resolves a Stellar federation address (e.g. user*petchain.app) to a public key.
 * Results are cached: positive for 15 min (or less per Cache-Control), negative for 2 min.
 */
export async function resolveFederationAddress(
  federatedAddress: string,
): Promise<ResolvedFederationAddress | null> {
  const key = federationCacheKey(federatedAddress);
  const cached = await get<CachedFederationEntry>(key);
  if (cached !== null) {
    return cached.result;
  }

  try {
    const server = await StellarSdk.Federation.Server.resolve(federatedAddress);
    const result: ResolvedFederationAddress = {
      stellar_address: federatedAddress,
      account_id: server.account_id,
      memo_type: server.memo_type,
      memo: server.memo,
    };
    await set<CachedFederationEntry>(key, { result }, CACHE_TTL_POSITIVE);
    return result;
  } catch (err: unknown) {
    // Cache negative results to prevent hammering upstream on bad addresses
    await set<CachedFederationEntry>(key, { result: null }, CACHE_TTL_NEGATIVE);
    return null;
  }
}

/**
 * Like resolveFederationAddress but respects the federation server's Cache-Control max-age.
 * Uses the lower of the server's TTL and our 15-min default.
 */
export async function resolveFederationAddressWithCacheControl(
  federatedAddress: string,
  cacheControlMaxAge?: number,
): Promise<ResolvedFederationAddress | null> {
  const ttl =
    cacheControlMaxAge !== undefined
      ? Math.min(cacheControlMaxAge, CACHE_TTL_POSITIVE)
      : CACHE_TTL_POSITIVE;

  const key = federationCacheKey(federatedAddress);
  const cached = await get<CachedFederationEntry>(key);
  if (cached !== null) {
    return cached.result;
  }

  try {
    const server = await StellarSdk.Federation.Server.resolve(federatedAddress);
    const result: ResolvedFederationAddress = {
      stellar_address: federatedAddress,
      account_id: server.account_id,
      memo_type: server.memo_type,
      memo: server.memo,
    };
    await set<CachedFederationEntry>(key, { result }, ttl);
    return result;
  } catch {
    await set<CachedFederationEntry>(key, { result: null }, CACHE_TTL_NEGATIVE);
    return null;
  }
}

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

// In-memory store (replace with DB in production)
const federationRecords = new Map<string, VetFederationRecord>(); // key: federatedAddress
const vetToAddress = new Map<string, string>(); // key: vetId → federatedAddress
const signedRecords = new Map<string, SignedRecord>(); // key: recordId

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
