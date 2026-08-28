/**
 * Verification service — wraps blockchainService to provide a clean API
 * for the RecordVerificationScreen and supports offline verification via
 * cached transaction data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  verifyMedicalRecord,
  getTransactionDetails,
  type StellarRecordVerification,
  type StellarTransactionDetails,
} from './blockchainService';
import type { MedicalRecord } from './medicalRecordService';

export type VerificationStatus = 'verified' | 'tampered' | 'unverified' | 'pending' | 'offline';

export interface VerificationResult {
  status: VerificationStatus;
  recordId: string;
  onChainHash?: string;
  localHash?: string;
  txHash?: string;
  ledger?: number;
  timestamp?: string;
  txDetails?: StellarTransactionDetails;
  cachedAt?: number;
}

const CACHE_PREFIX = '@verification_cache_';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function readCache(recordId: string): Promise<VerificationResult | null> {
  try {
    const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${recordId}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as VerificationResult;
    if (cached.cachedAt && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached;
    return null;
  } catch {
    return null;
  }
}

async function writeCache(result: VerificationResult): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${CACHE_PREFIX}${result.recordId}`,
      JSON.stringify({ ...result, cachedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}

/**
 * Verify a medical record against the Stellar blockchain.
 * Returns a cached result when offline or when a fresh result is available
 * within the TTL.
 */
export async function verifyRecord(record: MedicalRecord): Promise<VerificationResult> {
  const cached = await readCache(record.id);
  if (cached) return cached;

  try {
    const verification: StellarRecordVerification = await verifyMedicalRecord(
      record as import('./blockchainService').MedicalRecordWithChainData,
    );

    let txDetails: StellarTransactionDetails | undefined;
    if (verification.txHash) {
      try {
        txDetails = await getTransactionDetails(verification.txHash);
      } catch {
        // non-fatal — we still have the verification result
      }
    }

    const status: VerificationStatus = !verification.verified
      ? 'unverified'
      : verification.onChainHash
        ? 'verified'
        : 'unverified';

    const result: VerificationResult = {
      status,
      recordId: record.id,
      onChainHash: verification.onChainHash,
      txHash: verification.txHash,
      ledger: verification.ledger,
      timestamp: verification.timestamp,
      txDetails,
    };

    await writeCache(result);
    return result;
  } catch (err) {
    // Network error — try stale cache
    const stale = await AsyncStorage.getItem(`${CACHE_PREFIX}${record.id}`);
    if (stale) {
      const cached = JSON.parse(stale) as VerificationResult;
      return { ...cached, status: 'offline' };
    }
    return { status: 'unverified', recordId: record.id };
  }
}

/** Clear the verification cache for a specific record (e.g. after an update). */
export async function clearVerificationCache(recordId: string): Promise<void> {
  await AsyncStorage.removeItem(`${CACHE_PREFIX}${recordId}`);
}
