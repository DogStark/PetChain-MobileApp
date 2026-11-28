import api from './api';
import { getItem, setItem } from './localDB';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FosterHandoverDraft {
  /** Local date-time as typed by the user, e.g. "2026-10-20 18:30". */
  handedOverAt: string;
  food: string;
  medications: string;
  behavior: string;
  nextAppointment: string;
}

export interface FosterHandoverRecord {
  id: string;
  petId: string;
  /** ISO-8601 timestamp of the handover. */
  handedOverAt: string;
  food: string;
  medications: string;
  behavior: string;
  nextAppointment: string;
  /** Display name assigned by the server. Absent until the entry is synced. */
  recordedBy?: string;
  syncStatus: 'synced' | 'pending';
  /** ISO-8601 timestamp of when the entry was created on this device or server. */
  createdAt: string;
}

export type FosterHandoverFailure = 'denied' | 'unauthenticated' | 'error';

/** Server-confirmed access. Anything other than `granted` must not show cached data. */
export type FosterHandoverAccess =
  | { status: 'granted'; canWrite: boolean }
  | { status: FosterHandoverFailure };

export interface FosterHandoverSyncResult {
  records: FosterHandoverRecord[];
  /** The server could not be reached; `records` is the saved local copy. */
  reachable: boolean;
  /** Entries still waiting to be published; they retry on the next sync. */
  pendingCount: number;
  /** The server refused to list records (401/403). Local copy has been cleared. */
  accessDenied: boolean;
  /** The server refused to accept new entries (401/403). Unsent entries were discarded. */
  writeDenied: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_FIELD_LENGTH = 2000;
const MAX_CACHED_RECORDS = 50;
const MAX_SYNC_ATTEMPTS = 3;
const CACHE_PREFIX = 'fosterHandover:';
const NON_RETRYABLE_STATUSES = new Set([401, 403, 422]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function petPath(petId: string): string {
  return `/pets/${encodeURIComponent(petId)}/foster-handovers`;
}

function cacheKey(petId: string): string {
  return `${CACHE_PREFIX}${petId}`;
}

function statusFromError(error: unknown): number {
  return (error as { response?: { status?: number } })?.response?.status ?? 0;
}

function failureFromError(error: unknown): FosterHandoverFailure {
  const status = statusFromError(error);
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'denied';
  return 'error';
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toRecord(raw: unknown, syncStatus: FosterHandoverRecord['syncStatus']): FosterHandoverRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (
    typeof v.id !== 'string' ||
    typeof v.petId !== 'string' ||
    typeof v.handedOverAt !== 'string' ||
    typeof v.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: v.id,
    petId: v.petId,
    handedOverAt: v.handedOverAt,
    food: asText(v.food),
    medications: asText(v.medications),
    behavior: asText(v.behavior),
    nextAppointment: asText(v.nextAppointment),
    recordedBy: typeof v.recordedBy === 'string' ? v.recordedBy : undefined,
    syncStatus,
    createdAt: v.createdAt,
  };
}

function sortNewestFirst(records: FosterHandoverRecord[]): FosterHandoverRecord[] {
  return [...records]
    .sort((a, b) => Date.parse(b.handedOverAt) - Date.parse(a.handedOverAt))
    .slice(0, MAX_CACHED_RECORDS);
}

/** Parses the encrypted local copy. Corrupt or unexpected data is dropped, never shown. */
async function readCache(petId: string): Promise<FosterHandoverRecord[]> {
  try {
    const raw = await getItem(cacheKey(petId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortNewestFirst(
      parsed
        .map((item) => {
          const status = (item as { syncStatus?: unknown })?.syncStatus;
          return toRecord(item, status === 'pending' ? 'pending' : 'synced');
        })
        .filter((item): item is FosterHandoverRecord => item !== null),
    );
  } catch {
    return [];
  }
}

async function writeCache(petId: string, records: FosterHandoverRecord[]): Promise<void> {
  await setItem(cacheKey(petId), JSON.stringify(sortNewestFirst(records)));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (NON_RETRYABLE_STATUSES.has(statusFromError(error))) throw error;
      if (attempt < MAX_SYNC_ATTEMPTS - 1) {
        await delay(2 ** attempt * 250);
      }
    }
  }
  throw lastError;
}

/** Converts "YYYY-MM-DD HH:mm" (local time) to an ISO timestamp, or null when invalid. */
function parseHandedOverAt(input: string): string | null {
  const parsed = Date.parse(input.trim().replace(' ', 'T'));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** Returns a user-facing message for the first problem found, or null when the draft is valid. */
export function validateDraft(draft: FosterHandoverDraft): string | null {
  if (!parseHandedOverAt(draft.handedOverAt)) {
    return 'Enter a valid handover date and time, for example 2026-10-20 18:30.';
  }
  const fields: Array<[string, string]> = [
    ['Food', draft.food],
    ['Medications', draft.medications],
    ['Behavior', draft.behavior],
    ['Next appointment', draft.nextAppointment],
  ];
  for (const [label, value] of fields) {
    if (value.length > MAX_FIELD_LENGTH) {
      return `${label} must be ${MAX_FIELD_LENGTH} characters or fewer.`;
    }
  }
  const hasDetail = fields.some(([, value]) => value.trim().length > 0);
  if (!hasDetail) {
    return 'Add at least one detail: food, medications, behavior, or next appointment.';
  }
  return null;
}

// ─── Access ───────────────────────────────────────────────────────────────────

/**
 * Asks the server whether the current user may read and/or write handover
 * records for this pet. The client never infers access from local state.
 * Network failures resolve to `error`, never to `granted`.
 */
export async function checkAccess(petId: string): Promise<FosterHandoverAccess> {
  try {
    const response = await api.get<{ canRead?: boolean; canWrite?: boolean }>(
      `${petPath(petId)}/permission`,
    );
    if (response.data?.canRead !== true) return { status: 'denied' };
    return { status: 'granted', canWrite: response.data.canWrite === true };
  } catch (error) {
    return { status: failureFromError(error) };
  }
}

// ─── Local data ───────────────────────────────────────────────────────────────

/** Returns the saved local copy for a pet, newest first. */
export async function loadHandovers(petId: string): Promise<FosterHandoverRecord[]> {
  return readCache(petId);
}

/** Removes the local copy for a pet, e.g. when access has been revoked. */
export async function clearLocalHandovers(petId: string): Promise<void> {
  await writeCache(petId, []);
}

/**
 * Saves a handover locally first so it survives being offline. It is published
 * by {@link syncHandovers}. Throws with a user-facing message when invalid.
 */
export async function recordHandover(
  petId: string,
  draft: FosterHandoverDraft,
): Promise<FosterHandoverRecord[]> {
  const problem = validateDraft(draft);
  const handedOverAt = parseHandedOverAt(draft.handedOverAt);
  if (problem || !handedOverAt) {
    throw new Error(problem ?? 'Enter a valid handover date and time.');
  }

  const now = new Date().toISOString();
  const entry: FosterHandoverRecord = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    petId,
    handedOverAt,
    food: draft.food.trim(),
    medications: draft.medications.trim(),
    behavior: draft.behavior.trim(),
    nextAppointment: draft.nextAppointment.trim(),
    syncStatus: 'pending',
    createdAt: now,
  };

  const next = sortNewestFirst([entry, ...(await readCache(petId))]);
  await writeCache(petId, next);
  return next;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

async function publishEntry(
  petId: string,
  entry: FosterHandoverRecord,
): Promise<FosterHandoverRecord> {
  const response = await api.post<{ data: unknown }>(petPath(petId), {
    handedOverAt: entry.handedOverAt,
    food: entry.food,
    medications: entry.medications,
    behavior: entry.behavior,
    nextAppointment: entry.nextAppointment,
  });
  const saved = toRecord(response.data?.data, 'synced');
  if (!saved) {
    throw new Error('Unexpected handover response from server.');
  }
  return saved;
}

/**
 * Publishes queued entries (oldest first), then refreshes the local copy from
 * the server. Server 401/403 is authoritative: unsent entries are discarded and
 * cached records are cleared rather than shown to a user who lost access.
 */
export async function syncHandovers(petId: string): Promise<FosterHandoverSyncResult> {
  let records = await readCache(petId);
  let writeDenied = false;

  const queued = records.filter((record) => record.syncStatus === 'pending').reverse();
  for (const entry of queued) {
    try {
      const saved = await withRetry(() => publishEntry(petId, entry));
      records = records.map((record) => (record.id === entry.id ? saved : record));
    } catch (error) {
      const status = statusFromError(error);
      if (status === 401 || status === 403) {
        writeDenied = true;
        records = records.filter((record) => record.syncStatus !== 'pending');
        break;
      }
    }
  }

  let reachable = true;
  let accessDenied = false;
  try {
    const response = await api.get<{ data?: unknown[] }>(petPath(petId));
    const serverRecords = (response.data?.data ?? [])
      .map((item) => toRecord(item, 'synced'))
      .filter((item): item is FosterHandoverRecord => item !== null);
    const stillQueued = records.filter((record) => record.syncStatus === 'pending');
    records = sortNewestFirst([...stillQueued, ...serverRecords]);
  } catch (error) {
    const failure = failureFromError(error);
    if (failure === 'denied' || failure === 'unauthenticated') {
      accessDenied = true;
      records = [];
    } else {
      reachable = false;
    }
  }

  await writeCache(petId, records);

  return {
    records,
    reachable,
    pendingCount: records.filter((record) => record.syncStatus === 'pending').length,
    accessDenied,
    writeDenied,
  };
}

export const fosterHandoverService = {
  checkAccess,
  loadHandovers,
  clearLocalHandovers,
  recordHandover,
  syncHandovers,
  validateDraft,
};
