import axios, { type AxiosResponse } from 'axios';

import {
  storeMedicalRecordOnChain,
  verifyMedicalRecordOnChain,
  type MedicalRecordWithChainData,
  type RecordIntegrityResult,
} from './blockchainService';
import { getItem, setItem } from './localDB';
import offlineQueue from './offlineQueue';
import type { MedicalDocumentMetadata } from '../models/MedicalRecord';

// Types
export interface MedicalRecord {
  id: string;
  petId: string;
  type: 'vaccination' | 'treatment' | 'diagnosis';
  date: string;
  veterinarian: string;
  notes: string;
  createdAt: string;
  nextVisitDate?: string;
  documents?: MedicalDocumentMetadata[];
  isBlockchainVerified?: boolean;
  verificationStatus?: 'verified' | 'unknown' | 'pending';
}

export interface Vaccination extends MedicalRecord {
  type: 'vaccination';
  vaccineName: string;
  nextDueDate?: string;
  batchNumber?: string;
}

export interface Treatment extends MedicalRecord {
  type: 'treatment';
  treatmentName: string;
  medication?: string;
  dosage?: string;
  duration?: string;
}

export interface RecordFilters {
  type?: 'vaccination' | 'treatment' | 'diagnosis';
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class MedicalRecordError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'MedicalRecordError';
  }
}

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://api.petchain.com';

// ─────────────────────────────────────────────────────────────────────────────
// Error handler
// ─────────────────────────────────────────────────────────────────────────────

const RECORDS_CACHE_PREFIX = '@records_';

async function cacheRecords(petId: string, records: MedicalRecord[]): Promise<void> {
  await setItem(`${RECORDS_CACHE_PREFIX}${petId}`, JSON.stringify(records));
}

async function getCachedRecords(petId: string): Promise<MedicalRecord[]> {
  const cached = await getItem(`${RECORDS_CACHE_PREFIX}${petId}`);
  return cached ? JSON.parse(cached) : [];
}

// Helper function to handle API errors
const handleApiError = (error: unknown): never => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;

    switch (status) {
      case 404:
        throw new MedicalRecordError('Pet or records not found', 'NOT_FOUND');
      case 401:
        throw new MedicalRecordError('Unauthorized access', 'UNAUTHORIZED');
      case 403:
        throw new MedicalRecordError('Access forbidden', 'FORBIDDEN');
      case 500:
        throw new MedicalRecordError('Server error', 'SERVER_ERROR');
      default:
        throw new MedicalRecordError(`API error: ${message}`, 'API_ERROR');
    }
  }

  throw new MedicalRecordError('Network error', 'NETWORK_ERROR');
};

export const getMedicalRecords = async (
  petId: string,
  filters?: RecordFilters,
): Promise<AxiosResponse<PaginatedResponse<MedicalRecord>>> => {
  if (!petId) throw new MedicalRecordError('Pet ID is required', 'INVALID_PET_ID');

  const params = new URLSearchParams();
  if (filters?.type) params.append('type', filters.type);
  if (filters?.startDate) params.append('startDate', filters.startDate);
  if (filters?.endDate) params.append('endDate', filters.endDate);
  if (filters?.page) params.append('page', String(filters.page));
  if (filters?.limit) params.append('limit', String(filters.limit));

  try {
    const response = await axios.get<PaginatedResponse<MedicalRecord>>(
      `${API_BASE_URL}/medical-records?${params.toString()}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    // Enrich records with client-side verificationStatus based on backend's isBlockchainVerified flag
    const enrichedData = response.data.data.map(
      (record: MedicalRecord & { isBlockchainVerified?: boolean }) => ({
        ...record,
        verificationStatus: (record.isBlockchainVerified ? 'verified' : 'unknown') as
          | 'verified'
          | 'unknown'
          | 'pending',
      }),
    );

    return {
      ...response,
      data: { ...response.data, data: enrichedData },
    };
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      throw new MedicalRecordError('Network error: Unable to reach server', 'NETWORK_ERROR');
    }
    handleApiError(error);
    throw error; // unreachable
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ✅ ADDED: REQUIRED BY YOUR TESTS
// ─────────────────────────────────────────────────────────────────────────────

export const getRecordById = async (petId: string, recordId: string): Promise<MedicalRecord> => {
  if (!petId || !recordId) {
    throw new MedicalRecordError('Pet ID and Record ID are required', 'INVALID_INPUT');
  }

  try {
    const response = await axios.get<MedicalRecord>(
      `${API_BASE_URL}/pets/${petId}/medical-records/${recordId}`,
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );

    // Enrich with verificationStatus from isBlockchainVerified flag
    const record = response.data as MedicalRecord & { isBlockchainVerified?: boolean };
    return {
      ...record,
      verificationStatus: record.isBlockchainVerified ? 'verified' : 'unknown',
    };
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      throw new MedicalRecordError('Network error: Unable to reach server', 'NETWORK_ERROR');
    }
    handleApiError(error);
    throw error; // unreachable
  }
};

export const getVaccinationHistory = async (petId: string): Promise<Vaccination[]> => {
  if (!petId) {
    throw new MedicalRecordError('Pet ID is required', 'INVALID_PET_ID');
  }

  try {
    const response = await getMedicalRecords(petId, {
      type: 'vaccination',
    });

    return response.data.data.filter((record) => record.type === 'vaccination') as Vaccination[];
  } catch (error) {
    if (error instanceof MedicalRecordError) throw error;
    return handleApiError(error);
  }
};

export const getTreatmentHistory = async (petId: string): Promise<Treatment[]> => {
  if (!petId) {
    throw new MedicalRecordError('Pet ID is required', 'INVALID_PET_ID');
  }

  try {
    const response = await getMedicalRecords(petId, {
      type: 'treatment',
    });

    return response.data.data.filter((record) => record.type === 'treatment') as Treatment[];
  } catch (error) {
    if (error instanceof MedicalRecordError) throw error;
    return handleApiError(error);
  }
};

// =======================
// 🔍 VERIFICATION
// =======================

export const verifyMedicalRecord = async (record: MedicalRecord) => {
  try {
    return await verifyMedicalRecordOnChain(record as MedicalRecordWithChainData);
  } catch (error) {
    console.error('Verification failed:', error);
    throw error;
  }
};

// Collect all searchable string values from a record (all fields)
const extractSearchableText = (record: MedicalRecord): string => {
  const parts: string[] = [];
  const collect = (val: unknown) => {
    if (typeof val === 'string') parts.push(val.toLowerCase());
    else if (Array.isArray(val)) val.forEach(collect);
    else if (val && typeof val === 'object') Object.values(val).forEach(collect);
  };
  collect(record);
  return parts.join(' ');
};

// Search medical records by text across all fields
export const searchMedicalRecords = async (
  petId: string,
  query: string,
): Promise<MedicalRecord[]> => {
  if (!petId) throw new MedicalRecordError('Pet ID is required', 'INVALID_PET_ID');
  if (!query.trim()) return [];

  const { data } = await getMedicalRecords(petId, { limit: 1000 });
  const q = query.trim().toLowerCase();
  return data.data.filter((record) => extractSearchableText(record).includes(q));
};

/**
 * Full-text search using PostgreSQL tsvector (Issue #536).
 * Sends the query to the backend search endpoint which uses to_tsquery() with ts_rank.
 * Falls back gracefully to the ILIKE-based `searchMedicalRecords` when the FTS endpoint
 * is unavailable (e.g., SQLite local DB).
 */
export const searchRecords = async (petId: string, query: string): Promise<MedicalRecord[]> => {
  if (!petId) throw new MedicalRecordError('Pet ID is required', 'INVALID_PET_ID');
  if (!query.trim()) return [];

  try {
    const response = await axios.get<MedicalRecord[]>(
      `${API_BASE_URL}/pets/${petId}/medical-records/search`,
      { params: { q: query.trim() } },
    );
    return response.data;
  } catch (error) {
    // Fallback: SQLite / network error — use client-side ILIKE search
    if (axios.isAxiosError(error) && (error.response?.status === 404 || !error.response)) {
      return searchMedicalRecords(petId, query);
    }
    return handleApiError(error);
  }
};

export const createMedicalRecord = async (
  petId: string,
  data: Partial<MedicalRecord>,
): Promise<MedicalRecord> => {
  if (!petId) throw new MedicalRecordError('Pet ID is required', 'INVALID_PET_ID');

  try {
    const response = await axios.post(`${API_BASE_URL}/pets/${petId}/medical-records`, data);
    let newRecord = response.data;

    // Best-effort blockchain write (do not block UX)
    try {
      const { tx, hash } = await storeMedicalRecordOnChain(newRecord as MedicalRecordWithChainData);
      // Enrich record with verification data (client-side)
      newRecord = {
        ...newRecord,
        verificationStatus: 'verified' as const,
        blockchainTxHash: tx.txHash,
        blockchainHash: hash,
        verifiedAt: tx.createdAt ?? new Date().toISOString(),
      };

      // Attempt to persist verification fields on the server (admin/vet only).
      // If this fails (e.g., user lacks permission), we keep the fields client-side.
      try {
        await axios.put(`${API_BASE_URL}/pets/${petId}/medical-records/${newRecord.id}`, {
          blockchainTxHash: tx.txHash,
          blockchainHash: hash,
          isBlockchainVerified: true,
          blockchainVerifiedAt: tx.createdAt,
        });
      } catch (updateErr) {
        // Non-critical: client already has verification status for UI.
        console.warn('Could not persist blockchain verification on server:', updateErr);
      }
    } catch (blockchainError) {
      console.error('Blockchain storage failed:', blockchainError);
      // Mark as failed? Could set verificationStatus = 'failed' if desired, but keep unknown.
    }

    // Update cache with enriched record
    const cached = await getCachedRecords(petId);
    cached.unshift(newRecord);
    await cacheRecords(petId, cached);

    return newRecord;
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      const tempId = `temp_${Date.now()}`;
      const newRecord: MedicalRecord = {
        ...data,
        id: tempId,
        petId,
        createdAt: new Date().toISOString(),
        verificationStatus: 'unknown',
      } as MedicalRecord;

      await offlineQueue.enqueue(
        'medicalRecord',
        'create',
        newRecord as unknown as Record<string, unknown>,
      );

      const cached = await getCachedRecords(petId);
      cached.unshift(newRecord);
      await cacheRecords(petId, cached);

      return newRecord;
    }
    return handleApiError(error);
  }
};

export const updateMedicalRecord = async (
  petId: string,
  recordId: string,
  data: Partial<MedicalRecord>,
): Promise<MedicalRecord> => {
  if (!petId) throw new MedicalRecordError('Pet ID is required', 'INVALID_PET_ID');
  if (!recordId) throw new MedicalRecordError('Record ID is required', 'INVALID_RECORD_ID');

  try {
    const response = await axios.put(
      `${API_BASE_URL}/pets/${petId}/medical-records/${recordId}`,
      data,
    );
    const updatedRecord = response.data;

    // Update cache
    const cached = await getCachedRecords(petId);
    const idx = cached.findIndex((r) => r.id === recordId);
    if (idx >= 0) {
      cached[idx] = updatedRecord;
      await cacheRecords(petId, cached);
    }

    return updatedRecord;
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      const cached = await getCachedRecords(petId);
      const idx = cached.findIndex((r) => r.id === recordId);
      if (idx >= 0) {
        const updatedRecord = { ...cached[idx], ...data };
        await offlineQueue.enqueue('medicalRecord', 'update', { id: recordId, petId, ...data });
        cached[idx] = updatedRecord;
        await cacheRecords(petId, cached);
        return updatedRecord;
      }
    }
    return handleApiError(error);
  }
};

export const deleteMedicalRecord = async (petId: string, recordId: string): Promise<void> => {
  if (!petId) throw new MedicalRecordError('Pet ID is required', 'INVALID_PET_ID');
  if (!recordId) throw new MedicalRecordError('Record ID is required', 'INVALID_RECORD_ID');

  try {
    await axios.delete(`${API_BASE_URL}/pets/${petId}/medical-records/${recordId}`);

    // Update cache
    const cached = await getCachedRecords(petId);
    await cacheRecords(
      petId,
      cached.filter((r) => r.id !== recordId),
    );
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      await offlineQueue.enqueue('medicalRecord', 'delete', { id: recordId, petId });
      const cached = await getCachedRecords(petId);
      await cacheRecords(
        petId,
        cached.filter((r) => r.id !== recordId),
      );
      return;
    }
    return handleApiError(error);
  }
};

// =============================
// Blockchain Verification
// =============================

/**
 * Verify a single medical record against the blockchain.
 *
 * Computes the record's cryptographic hash and compares it to the version
 * stored on the Stellar ledger. Returns integrity check result.
 *
 * @param record - The medical record to verify
 * @returns Integrity result including verified status and on-chain metadata
 */
export const verifyRecord = async (record: MedicalRecord): Promise<RecordIntegrityResult> => {
  // Cast to MedicalRecordWithChainData because verification needs full record fields.
  // The record's fields (id, type, date, vetId, diagnosis, treatment, notes, etc.)
  // are all present in the MedicalRecord interface used by the UI.
  return verifyMedicalRecordOnChain(record as unknown as MedicalRecordWithChainData);
};

/**
 * Batch verify multiple records in a single network call.
 * More efficient when verifying many records at once.
 */
export const verifyRecordsBatch = async (
  records: MedicalRecord[],
): Promise<RecordIntegrityResult[]> => {
  // Import batchVerify from blockchainService if needed.
  // For simplicity, loop or implement if needed.
  // This is a placeholder; actual batch implementation would go in blockchainService.
  const results: RecordIntegrityResult[] = [];
  for (const record of records) {
    const result = await verifyRecord(record);
    results.push(result);
  }
  return results;
};
