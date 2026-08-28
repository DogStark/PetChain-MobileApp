import apiClient from './apiClient';
import { getItem, setItem, removeItem } from './localDB';
import { logError } from '../utils/errorLogger';

// ─────────────────────────────────────────────────────────────
// GDPR DATA RIGHTS
// ─────────────────────────────────────────────────────────────

export interface DataExportPayload {
  userId: string;
  exportedAt: string;
  pets: unknown[];
  appointments: unknown[];
  medicalRecords: unknown[];
  accountInfo: unknown;
}

export interface ConsentRecord {
  purpose: string;
  granted: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
  version: string;
}

// ─────────────────────────────────────────────────────────────
// CONSENT MANAGEMENT
// ─────────────────────────────────────────────────────────────

const CONSENT_KEY = '@gdpr_consents';

export async function getConsents(): Promise<ConsentRecord[]> {
  try {
    const stored = await getItem(CONSENT_KEY);
    return stored ? (JSON.parse(stored) as ConsentRecord[]) : [];
  } catch (err) {
    logError(err as Error, { context: 'getConsents' });
    return [];
  }
}

export async function recordConsent(
  purpose: string,
  granted: boolean,
  version = '1.0',
): Promise<void> {
  try {
    const consents = await getConsents();
    const idx = consents.findIndex((c) => c.purpose === purpose);
    const record: ConsentRecord = {
      purpose,
      granted,
      grantedAt: granted ? new Date().toISOString() : null,
      revokedAt: granted ? null : new Date().toISOString(),
      version,
    };

    if (idx >= 0) {
      consents[idx] = record;
    } else {
      consents.push(record);
    }

    await setItem(CONSENT_KEY, JSON.stringify(consents));

    // Sync consent to server
    await apiClient.post('/compliance/consent', record).catch(() => {
      // Best-effort: local consent is source of truth
    });
  } catch (err) {
    logError(err as Error, { context: 'recordConsent' });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// GDPR DATA EXPORT (Right to Data Portability — Art. 20)
// ─────────────────────────────────────────────────────────────

export async function requestDataExport(userId: string): Promise<DataExportPayload> {
  const response = await apiClient.get<DataExportPayload>(`/compliance/export/${userId}`);
  return response.data;
}

// ─────────────────────────────────────────────────────────────
// GDPR RIGHT TO ERASURE (Art. 17)
// ─────────────────────────────────────────────────────────────

export async function requestAccountDeletion(
  userId: string,
  reason?: string,
): Promise<{ deletionScheduledAt: string; completionEstimate: string }> {
  const response = await apiClient.post<{
    deletionScheduledAt: string;
    completionEstimate: string;
  }>(`/compliance/delete/${userId}`, { reason });

  // Clear all local data immediately upon successful deletion request
  await clearLocalUserData();
  return response.data;
}

async function clearLocalUserData(): Promise<void> {
  const keys = [
    '@auth_token',
    '@user_profile',
    '@gdpr_consents',
    '@sync_queue',
    '@sync_status',
    '@pets_cache',
    '@appointments_cache',
  ];
  for (const key of keys) {
    await removeItem(key).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────
// RECORDS RETENTION POLICY
// ─────────────────────────────────────────────────────────────

/**
 * Returns ISO date string before which records should be archived/deleted
 * according to the applicable retention policy.
 *
 * @param policyYears  - number of years to retain records (default: 7 for HIPAA-aligned)
 */
export function getRetentionCutoffDate(policyYears = 7): string {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - policyYears);
  return cutoff.toISOString();
}

export interface RetentionCheckResult {
  recordId: string;
  createdAt: string;
  shouldArchive: boolean;
  daysUntilArchive: number;
}

export function checkRetention(
  records: { id: string; createdAt: string }[],
  policyYears = 7,
): RetentionCheckResult[] {
  const cutoff = new Date(getRetentionCutoffDate(policyYears));
  const now = Date.now();

  return records.map((r) => {
    const created = new Date(r.createdAt);
    const archiveDate = new Date(created);
    archiveDate.setFullYear(archiveDate.getFullYear() + policyYears);

    return {
      recordId: r.id,
      createdAt: r.createdAt,
      shouldArchive: created < cutoff,
      daysUntilArchive: Math.max(0, Math.ceil((archiveDate.getTime() - now) / 86_400_000)),
    };
  });
}

// ─────────────────────────────────────────────────────────────
// HIPAA — Minimum Necessary Access
// ─────────────────────────────────────────────────────────────

/**
 * Redacts PHI fields from a medical record object for contexts where
 * full PHI access is not required (e.g. analytics, logging).
 */
export function redactPHI<T extends Record<string, unknown>>(record: T): Partial<T> {
  const PHI_FIELDS = [
    'name',
    'email',
    'phone',
    'address',
    'ssn',
    'dateOfBirth',
    'medicalHistory',
    'diagnosis',
    'medications',
    'insuranceId',
  ];

  const redacted: Partial<T> = { ...record };
  for (const field of PHI_FIELDS) {
    if (field in redacted) {
      (redacted as Record<string, unknown>)[field] = '[REDACTED]';
    }
  }
  return redacted;
}
