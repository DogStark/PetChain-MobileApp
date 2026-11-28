/**
 * Sync retry details — Issue #1178
 *
 * Surfaces why a queued change failed to sync and lets the user retry it
 * explicitly.
 *
 * Privacy:
 *  - Only queue metadata is read. The record payload (pet names, notes,
 *    medical details, …) is never selected, returned, or rendered.
 *  - Error text is treated as untrusted: JSON/object dumps are removed and
 *    the remaining message is length-bounded before it reaches the UI.
 *
 * Permissions:
 *  - The retry is performed against the authenticated API. A server 401/403
 *    is the authoritative denial; the client never grants retry access from
 *    local state. Denied records stay queued so no local change is lost.
 *
 * Offline:
 *  - Reading retry details works from the local queue. The retry action is
 *    refused while offline, preserving the existing offline-first behaviour.
 */

import { networkMonitor } from '../utils/networkMonitor';
import syncEngine, {
  type SyncAction,
  type SyncEntityType,
  type SyncRetryRecord,
} from './syncEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Sanitized, render-ready retry metadata. Never contains a record payload. */
export interface SyncRetryDetail {
  /** Stable identifier of the queued change. */
  recordId: string;
  entityType: SyncEntityType;
  /** Short, privacy-preserving reference to the affected record. */
  recordReference: string;
  action: SyncAction;
  /** Failed attempts recorded for this change. */
  retryCount: number;
  maxRetries: number;
  /** True once automatic backoff retries are paused. Manual retry still works. */
  exhausted: boolean;
  /** Sanitized last sync error, safe to render and announce. */
  lastError: string;
  /** False when the last attempt recorded no error text. */
  hasErrorDetail: boolean;
  /** ISO timestamp of when the queued change was last edited. */
  queuedAt: string;
  /** Version at the time the detail was read; used for stale detection. */
  syncVersion: number;
}

export interface SyncRetryListResult {
  details: SyncRetryDetail[];
  isOffline: boolean;
}

export type RetrySyncResult =
  | { outcome: 'completed' }
  | { outcome: 'stale' }
  | { outcome: 'offline' }
  | { outcome: 'permission-denied'; message: string }
  | { outcome: 'failed'; message: string };

// ─── Display helpers ──────────────────────────────────────────────────────────

export const SYNC_ENTITY_LABELS: Record<SyncEntityType, string> = {
  pet: 'Pet',
  appointment: 'Appointment',
  medication: 'Medication',
  medicalRecord: 'Medical record',
  streak: 'Routine streak',
  badge: 'Badge',
};

export const SYNC_ACTION_LABELS: Record<SyncAction, string> = {
  create: 'New record',
  update: 'Update',
  delete: 'Deletion',
};

const FALLBACK_ERROR = 'No error details were recorded.';
const MAX_ERROR_LENGTH = 180;

/**
 * Makes an error message safe to show in the UI.
 *
 * Object/array sections are redacted so a server error can never echo back
 * private payload values. Control characters are collapsed and the result is
 * capped at {@link MAX_ERROR_LENGTH} characters.
 */
export function sanitizeSyncErrorMessage(raw: unknown): string {
  if (typeof raw !== 'string') return FALLBACK_ERROR;

  let message = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Never render JSON blobs or object dumps from an upstream response.
  message = message.replace(/\{[\s\S]*\}|\[[\s\S]*\]/g, '[details hidden]').trim();

  if (!message) return FALLBACK_ERROR;
  if (message.length > MAX_ERROR_LENGTH) {
    message = `${message.slice(0, MAX_ERROR_LENGTH - 1)}…`;
  }
  return message;
}

/**
 * Shortens an entity id for display. The queue needs the full id to retry, but
 * the detail view only needs to identify the record.
 */
export function formatRecordReference(entityId: string): string {
  const trimmed = typeof entityId === 'string' ? entityId.trim() : '';
  if (!trimmed) return 'Unknown record';
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

function toDetail(record: SyncRetryRecord, maxRetries: number): SyncRetryDetail {
  const retryCount = Number.isFinite(record.attempts) ? Math.max(0, record.attempts) : 0;
  const retryLimit = Number.isFinite(maxRetries) ? Math.max(0, maxRetries) : 0;
  const rawError = typeof record.lastError === 'string' ? record.lastError.trim() : '';

  return {
    recordId: record.id,
    entityType: record.entityType,
    recordReference: formatRecordReference(record.entityId),
    action: record.action,
    retryCount,
    maxRetries: retryLimit,
    exhausted: retryCount >= retryLimit,
    lastError: sanitizeSyncErrorMessage(rawError),
    hasErrorDetail: rawError.length > 0,
    queuedAt: record.updatedAt,
    syncVersion: record.syncVersion,
  };
}

async function readOffline(): Promise<boolean> {
  try {
    return !(await networkMonitor.isOnline());
  } catch {
    // Treat an unknown connection as online; the retry itself re-checks.
    return false;
  }
}

/**
 * Loads retry details from the local queue, optionally narrowed to one record.
 * This never performs a network request, so it works offline.
 */
export async function loadSyncRetryDetails(recordId?: string): Promise<SyncRetryListResult> {
  const [records, isOffline] = await Promise.all([
    syncEngine.listRetryRecords(),
    readOffline(),
  ]);

  const maxRetries = syncEngine.getRetryLimit();
  const filtered = recordId ? records.filter((record) => record.id === recordId) : records;

  return {
    details: filtered.map((record) => toDetail(record, maxRetries)),
    isOffline,
  };
}

// ─── Retry ────────────────────────────────────────────────────────────────────

/**
 * Retries one queued change after an explicit user action.
 *
 * The snapshot passed by the caller is compared with the stored record first;
 * if it changed (or was already synced) the retry is refused as stale instead
 * of overwriting newer local state.
 */
export async function retrySyncDetail(detail: SyncRetryDetail): Promise<RetrySyncResult> {
  const result = await syncEngine.retryRecord(detail.recordId, {
    attempts: detail.retryCount,
    syncVersion: detail.syncVersion,
  });

  switch (result.type) {
    case 'completed':
      return { outcome: 'completed' };
    case 'stale':
      return { outcome: 'stale' };
    case 'offline':
      return { outcome: 'offline' };
    case 'permission-denied':
      return {
        outcome: 'permission-denied',
        message: 'The server denied permission to retry this change.',
      };
    case 'failed':
      return { outcome: 'failed', message: sanitizeSyncErrorMessage(result.message) };
  }
}

const syncRetryService = {
  loadSyncRetryDetails,
  retrySyncDetail,
  sanitizeSyncErrorMessage,
  formatRecordReference,
};

export default syncRetryService;
