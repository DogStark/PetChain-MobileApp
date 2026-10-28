/**
 * Offline draft queue status — Issue #1181
 *
 * Tracks drafts by feature as pending, retrying, blocked, or completed with
 * timestamps, and exposes explicit user actions for conflicts. Only draft
 * metadata (feature, status, labels) is listed; draft bodies stay with the
 * owning feature so sensitive pet data is not surfaced here.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type DraftStatus = 'pending' | 'retrying' | 'blocked' | 'completed';
export type BlockedReason = 'conflict' | 'permission_denied';
export type ConflictAction = 'keep_mine' | 'keep_server' | 'discard';

export interface DraftEntry {
  id: string;
  feature: string;
  status: DraftStatus;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  blockedReason?: BlockedReason;
}

export interface DraftFeatureGroup {
  feature: string;
  drafts: DraftEntry[];
  counts: Record<DraftStatus, number>;
}

const STORAGE_KEY = 'draftQueueStatus:v1';
const STATUS_ORDER: DraftStatus[] = ['blocked', 'retrying', 'pending', 'completed'];

async function readAll(): Promise<DraftEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as DraftEntry[]) : [];
  } catch {
    return [];
  }
}

const writeAll = (drafts: DraftEntry[]) =>
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));

export async function enqueueDraft(id: string, feature: string, now = Date.now()): Promise<void> {
  const drafts = (await readAll()).filter((d) => d.id !== id);
  drafts.push({ id, feature, status: 'pending', createdAt: now, updatedAt: now, attempts: 0 });
  await writeAll(drafts);
}

/** Record a sync attempt outcome. 409 → conflict, 401/403 → permission denied. */
export async function recordSyncResult(
  id: string,
  outcome: 'success' | 'failed' | { httpStatus: number },
  now = Date.now(),
): Promise<DraftEntry | null> {
  const drafts = await readAll();
  const draft = drafts.find((d) => d.id === id);
  if (!draft) return null;

  draft.updatedAt = now;
  draft.attempts += 1;
  if (outcome === 'success') {
    draft.status = 'completed';
    delete draft.blockedReason;
  } else if (outcome !== 'failed' && outcome.httpStatus === 409) {
    draft.status = 'blocked';
    draft.blockedReason = 'conflict';
  } else if (outcome !== 'failed' && (outcome.httpStatus === 401 || outcome.httpStatus === 403)) {
    draft.status = 'blocked';
    draft.blockedReason = 'permission_denied';
  } else {
    draft.status = 'retrying';
  }
  await writeAll(drafts);
  return draft;
}

/** Explicit user resolution for a conflicted draft. */
export async function resolveConflict(
  id: string,
  action: ConflictAction,
  now = Date.now(),
): Promise<DraftEntry | null> {
  const drafts = await readAll();
  const draft = drafts.find((d) => d.id === id);
  if (!draft || draft.status !== 'blocked' || draft.blockedReason !== 'conflict') return null;

  if (action === 'keep_mine') {
    draft.status = 'pending';
    delete draft.blockedReason;
    draft.updatedAt = now;
    await writeAll(drafts);
    return draft;
  }
  await writeAll(drafts.filter((d) => d.id !== id));
  return { ...draft, status: 'completed', updatedAt: now, blockedReason: undefined };
}

export async function clearCompletedDrafts(): Promise<void> {
  await writeAll((await readAll()).filter((d) => d.status !== 'completed'));
}

export async function getDraftQueueByFeature(): Promise<DraftFeatureGroup[]> {
  const groups = new Map<string, DraftEntry[]>();
  for (const draft of await readAll()) {
    groups.set(draft.feature, [...(groups.get(draft.feature) ?? []), draft]);
  }
  return Array.from(groups, ([feature, drafts]) => ({
    feature,
    drafts: drafts.sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        b.updatedAt - a.updatedAt,
    ),
    counts: {
      pending: drafts.filter((d) => d.status === 'pending').length,
      retrying: drafts.filter((d) => d.status === 'retrying').length,
      blocked: drafts.filter((d) => d.status === 'blocked').length,
      completed: drafts.filter((d) => d.status === 'completed').length,
    },
  })).sort((a, b) => a.feature.localeCompare(b.feature));
}

/** Screen-reader label for a single draft row. */
export function describeDraft(draft: DraftEntry, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - draft.updatedAt) / 60000));
  const when = minutes < 1 ? 'just now' : `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const reason =
    draft.blockedReason === 'conflict'
      ? ', conflict needs your decision'
      : draft.blockedReason === 'permission_denied'
        ? ', access was revoked'
        : '';
  return `${draft.feature} draft ${draft.status}${reason}, updated ${when}`;
}
