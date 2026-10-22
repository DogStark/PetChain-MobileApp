import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Resumable attachment upload metadata.
 *
 * This is intentionally stored separately from the medical record so that
 * interrupted uploads never leave an apparently-uploaded record whose remote
 * object is incomplete or corrupted. A record is only marked uploaded once the
 * completed object's hash has been verified.
 */
export type PendingUploadStatus =
  | 'pending'
  | 'uploading'
  | 'quarantined'
  | 'verified'
  | 'failed';

export interface PendingUploadChunk {
  /** Zero-based index of the chunk within the object. */
  index: number;
  /** Byte offset of this chunk within the object. */
  offset: number;
  /** Byte length of this chunk. */
  length: number;
  /** Number of failed attempts for this chunk. */
  attempts: number;
  /** True when the chunk failed and is awaiting retry. */
  quarantined: boolean;
}

export interface PendingUpload {
  /** Stable id for the upload, unique per account. */
  id: string;
  /** Account that owns this upload; used for account isolation on logout. */
  accountId: string;
  /** Medical record this attachment belongs to. */
  recordId: string;
  /** Local file uri of the attachment being uploaded. */
  fileUri: string;
  /** Total size of the object in bytes. */
  totalBytes: number;
  /** Chunk size used for this upload. */
  chunkSize: number;
  /**
   * Offset confirmed by the server. Uploads always resume from this value,
   * never from a locally assumed offset.
   */
  confirmedOffset: number;
  /** Expected hash of the fully assembled object. */
  expectedHash: string;
  /** Hash reported by the server after assembly, once available. */
  serverHash?: string;
  status: PendingUploadStatus;
  /** Bounded retry counter for the whole upload. */
  attempts: number;
  /** Chunks that failed and are quarantined for retry. */
  quarantinedChunks: PendingUploadChunk[];
  /** Last error surfaced to the user, if any. */
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

/** Maximum number of retries before an upload is marked failed. */
export const MAX_UPLOAD_ATTEMPTS = 5;

const STORAGE_KEY = '@handsoff/pending_uploads/v1';

interface PersistedShape {
  uploads: PendingUpload[];
}

async function readAll(): Promise<PendingUpload[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as PersistedShape;
    if (!parsed || !Array.isArray(parsed.uploads)) {
      return [];
    }
    return parsed.uploads;
  } catch {
    return [];
  }
}

async function writeAll(uploads: PendingUpload[]): Promise<void> {
  const payload: PersistedShape = { uploads };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

/**
 * Persist or update resumable upload metadata. Kept separate from the medical
 * record so record persistence is never coupled to upload progress.
 */
export async function savePendingUpload(upload: PendingUpload): Promise<void> {
  const uploads = await readAll();
  const next = uploads.filter((u) => u.id !== upload.id);
  next.push({ ...upload, updatedAt: Date.now() });
  await writeAll(next);
}

export async function getPendingUpload(id: string): Promise<PendingUpload | null> {
  const uploads = await readAll();
  return uploads.find((u) => u.id === id) ?? null;
}

export async function listPendingUploads(accountId: string): Promise<PendingUpload[]> {
  const uploads = await readAll();
  return uploads.filter((u) => u.accountId === accountId);
}

/**
 * Record the server-confirmed offset. Resume logic must only ever use this
 * value, so a locally assumed offset can never skip unacknowledged bytes.
 */
export async function confirmOffset(id: string, confirmedOffset: number): Promise<void> {
  const uploads = await readAll();
  const next = uploads.map((u) =>
    u.id === id
      ? {
          ...u,
          confirmedOffset: Math.max(u.confirmedOffset, confirmedOffset),
          updatedAt: Date.now(),
        }
      : u,
  );
  await writeAll(next);
}

/**
 * Quarantine a failed chunk so it is retried on the next resume attempt.
 * Retries are bounded by MAX_UPLOAD_ATTEMPTS.
 */
export async function quarantineChunk(
  id: string,
  chunk: PendingUploadChunk,
  error?: string,
): Promise<PendingUpload | null> {
  const uploads = await readAll();
  let updated: PendingUpload | null = null;
  const next = uploads.map((u) => {
    if (u.id !== id) {
      return u;
    }
    const attempts = u.attempts + 1;
    const quarantinedChunks = u.quarantinedChunks.filter((c) => c.index !== chunk.index);
    quarantinedChunks.push({
      ...chunk,
      attempts: chunk.attempts + 1,
      quarantined: true,
    });
    updated = {
      ...u,
      attempts,
      quarantinedChunks,
      status: attempts >= MAX_UPLOAD_ATTEMPTS ? 'failed' : 'quarantined',
      lastError: error ?? u.lastError,
      updatedAt: Date.now(),
    };
    return updated;
  });
  await writeAll(next);
  return updated;
}

/**
 * Verify the completed object's hash before the record may be marked uploaded.
 * A mismatch never marks the record uploaded and keeps the upload quarantined.
 */
export async function verifyCompletedUpload(
  id: string,
  serverHash: string,
): Promise<{ verified: boolean; upload: PendingUpload | null }> {
  const uploads = await readAll();
  let result: PendingUpload | null = null;
  let verified = false;
  const next = uploads.map((u) => {
    if (u.id !== id) {
      return u;
    }
    verified = u.expectedHash === serverHash;
    result = {
      ...u,
      serverHash,
      status: verified ? 'verified' : 'quarantined',
      lastError: verified ? undefined : 'Integrity check failed: hash mismatch',
      updatedAt: Date.now(),
    };
    return result;
  });
  await writeAll(next);
  return { verified, upload: result };
}

/**
 * Remove only the current account's pending upload metadata. Used on logout or
 * account switch so other accounts' resumable uploads are preserved.
 */
export async function clearPendingUploadsForAccount(accountId: string): Promise<void> {
  const uploads = await readAll();
  await writeAll(uploads.filter((u) => u.accountId !== accountId));
}
