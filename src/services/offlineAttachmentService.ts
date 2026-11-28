/**
 * Selective attachment download controls — Issue #1180
 *
 * Users opt individual records in to offline storage. Each selection keeps a
 * size estimate and an expiry; access is re-confirmed with the server and the
 * cached file is deleted as soon as access is revoked or the copy expires.
 * Nothing is cached unless the user explicitly selects it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

import api from './api';
import { isPermissionDenied } from './offlineServerCache';
import { networkMonitor } from '../utils/networkMonitor';

export interface OfflineAttachment {
  recordId: string;
  attachmentId: string;
  sizeBytes: number;
  localUri: string;
  savedAt: number;
  expiresAt: number;
}

export const DEFAULT_OFFLINE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'offlineAttachments:v1';

async function readAll(): Promise<OfflineAttachment[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as OfflineAttachment[]) : [];
  } catch {
    return [];
  }
}

const writeAll = (items: OfflineAttachment[]) =>
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));

async function deleteFile(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // A missing file is already removed.
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Storage estimate for a set of attachments the user is considering. */
export function estimateStorage(attachments: { sizeBytes: number }[]): {
  totalBytes: number;
  label: string;
} {
  const totalBytes = attachments.reduce((sum, a) => sum + Math.max(0, a.sizeBytes || 0), 0);
  return { totalBytes, label: formatBytes(totalBytes) };
}

export async function getOfflineAttachments(): Promise<OfflineAttachment[]> {
  return readAll();
}

/** Download an attachment for offline use after the server confirms access. */
export async function keepAttachmentOffline(
  recordId: string,
  attachment: { id: string; url: string; sizeBytes: number },
  ttlMs = DEFAULT_OFFLINE_TTL_MS,
  now = Date.now(),
): Promise<
  { status: 'saved'; item: OfflineAttachment } | { status: 'offline' | 'denied' | 'error' }
> {
  if (!(await networkMonitor.isOnline())) return { status: 'offline' };
  try {
    const { data } = await api.get(`/records/${encodeURIComponent(recordId)}/permissions`);
    if ((data as { canView?: unknown } | null)?.canView !== true) return { status: 'denied' };
  } catch (error) {
    return { status: isPermissionDenied(error) ? 'denied' : 'error' };
  }

  const localUri = `${FileSystem.documentDirectory}offline-attachments/${encodeURIComponent(attachment.id)}`;
  try {
    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}offline-attachments`, {
      intermediates: true,
    });
    await FileSystem.downloadAsync(attachment.url, localUri);
  } catch {
    await deleteFile(localUri);
    return { status: 'error' };
  }

  const item: OfflineAttachment = {
    recordId,
    attachmentId: attachment.id,
    sizeBytes: attachment.sizeBytes,
    localUri,
    savedAt: now,
    expiresAt: now + ttlMs,
  };
  await writeAll([...(await readAll()).filter((a) => a.attachmentId !== attachment.id), item]);
  return { status: 'saved', item };
}

export async function removeOfflineAttachment(attachmentId: string): Promise<void> {
  const items = await readAll();
  const target = items.find((a) => a.attachmentId === attachmentId);
  if (target) await deleteFile(target.localUri);
  await writeAll(items.filter((a) => a.attachmentId !== attachmentId));
}

/**
 * Remove expired copies and, when online, any whose record access the server
 * no longer confirms. Offline, unexpired copies are kept. Returns removed ids.
 */
export async function pruneOfflineAttachments(now = Date.now()): Promise<string[]> {
  const items = await readAll();
  const online = await networkMonitor.isOnline();
  const access = new Map<string, boolean>();
  const kept: OfflineAttachment[] = [];
  const removed: string[] = [];

  for (const item of items) {
    let keep = item.expiresAt > now;
    if (keep && online) {
      if (!access.has(item.recordId)) {
        try {
          const { data } = await api.get(
            `/records/${encodeURIComponent(item.recordId)}/permissions`,
          );
          access.set(item.recordId, (data as { canView?: unknown } | null)?.canView !== false);
        } catch (error) {
          access.set(item.recordId, !isPermissionDenied(error));
        }
      }
      keep = access.get(item.recordId) === true;
    }
    if (keep) {
      kept.push(item);
    } else {
      await deleteFile(item.localUri);
      removed.push(item.attachmentId);
    }
  }

  await writeAll(kept);
  return removed;
}

/** Screen-reader label describing an offline copy's size and expiry. */
export function describeOfflineAttachment(item: OfflineAttachment, now = Date.now()): string {
  const days = Math.max(0, Math.ceil((item.expiresAt - now) / (24 * 60 * 60 * 1000)));
  return `Saved offline, ${formatBytes(item.sizeBytes)}, expires in ${days} day${days === 1 ? '' : 's'}`;
}
