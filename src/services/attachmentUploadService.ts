import { Platform } from 'react-native';

/**
 * Resumable, integrity-verified attachment upload service.
 *
 * Resumable upload metadata is stored separately from the medical record so
 * that record persistence is never coupled to in-flight upload state. A record
 * is only marked uploaded after the completed object's hash matches the local
 * hash. Failed chunks are quarantined and retried with a bounded attempt count.
 */

export type UploadStatus =
  | 'pending'
  | 'uploading'
  | 'quarantined'
  | 'completed'
  | 'failed';

export interface UploadChunk {
  index: number;
  size: number;
  attempts: number;
  quarantined: boolean;
}

/**
 * Resumable upload metadata. Deliberately stored in its own store, keyed by
 * account + record, and never embedded in the medical record itself.
 */
export interface UploadMetadata {
  uploadId: string;
  accountId: string;
  recordId: string;
  attachmentId: string;
  fileName: string;
  totalSize: number;
  chunkSize: number;
  /** Offset the server has confirmed it durably holds. */
  confirmedOffset: number;
  /** Local hash of the full object, used for final integrity verification. */
  localHash: string;
  chunks: UploadChunk[];
  status: UploadStatus;
  createdAt: number;
  updatedAt: number;
}

/** Bounded retry policy so retries stay visible and cannot loop forever. */
export const MAX_CHUNK_ATTEMPTS = 3;

export interface ChunkServer {
  /** Returns the offset the server has durably confirmed for this upload. */
  getConfirmedOffset(uploadId: string): Promise<number>;
  /** Uploads a chunk at the given offset; resolves with the new confirmed offset. */
  uploadChunk(
    uploadId: string,
    offset: number,
    data: string,
  ): Promise<{ confirmedOffset: number }>;
  /** Returns the server-computed hash of the completed object. */
  getObjectHash(uploadId: string): Promise<string>;
}

/**
 * Pluggable metadata store. Kept separate from record persistence so logout or
 * account switch can clear only the current account's pending uploads.
 */
export interface UploadMetadataStore {
  get(uploadId: string): Promise<UploadMetadata | null>;
  put(metadata: UploadMetadata): Promise<void>;
  remove(uploadId: string): Promise<void>;
  listByAccount(accountId: string): Promise<UploadMetadata[]>;
}

/** In-memory default store; swap for persistent storage in the app shell. */
export class InMemoryUploadMetadataStore implements UploadMetadataStore {
  private readonly items = new Map<string, UploadMetadata>();

  async get(uploadId: string): Promise<UploadMetadata | null> {
    return this.items.get(uploadId) ?? null;
  }

  async put(metadata: UploadMetadata): Promise<void> {
    this.items.set(metadata.uploadId, metadata);
  }

  async remove(uploadId: string): Promise<void> {
    this.items.delete(uploadId);
  }

  async listByAccount(accountId: string): Promise<UploadMetadata[]> {
    return [...this.items.values()].filter((m) => m.accountId === accountId);
  }
}

export interface UploadResult {
  status: UploadStatus;
  confirmedOffset: number;
  /** True only when the final hash matched and the record may be marked uploaded. */
  verified: boolean;
  attempts: number;
}

/**
 * Deterministic, dependency-free hash used for integrity verification.
 * Replace with a platform crypto digest when available; the contract is that
 * the same input always yields the same digest.
 */
export function hashObject(data: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < data.length; i++) {
    const ch = data.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0')
  );
}

function splitIntoChunks(data: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }
  return chunks.length > 0 ? chunks : [''];
}

/**
 * Creates resumable upload metadata for an attachment. The metadata lives in
 * the upload store, not on the medical record.
 */
export function createUploadMetadata(params: {
  uploadId: string;
  accountId: string;
  recordId: string;
  attachmentId: string;
  fileName: string;
  data: string;
  chunkSize?: number;
}): UploadMetadata {
  const chunkSize = params.chunkSize ?? 64 * 1024;
  const parts = splitIntoChunks(params.data, chunkSize);
  const now = Date.now();
  return {
    uploadId: params.uploadId,
    accountId: params.accountId,
    recordId: params.recordId,
    attachmentId: params.attachmentId,
    fileName: params.fileName,
    totalSize: params.data.length,
    chunkSize,
    confirmedOffset: 0,
    localHash: hashObject(params.data),
    chunks: parts.map((part, index) => ({
      index,
      size: part.length,
      attempts: 0,
      quarantined: false,
    })),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Resumes an interrupted upload from the server-confirmed offset. Chunks that
 * fail are quarantined and retried up to MAX_CHUNK_ATTEMPTS. The record is only
 * reported as uploaded when the final object hash matches the local hash.
 */
export async function resumeUpload(params: {
  metadata: UploadMetadata;
  data: string;
  server: ChunkServer;
  store: UploadMetadataStore;
}): Promise<UploadResult> {
  const { data, server, store } = params;
  const metadata: UploadMetadata = { ...params.metadata, chunks: params.metadata.chunks.map((c) => ({ ...c })) };

  // Trust only the server-confirmed offset, never a locally assumed one.
  const serverOffset = await server.getConfirmedOffset(metadata.uploadId);
  metadata.confirmedOffset = Math.min(serverOffset, data.length);
  metadata.status = 'uploading';
  metadata.updatedAt = Date.now();
  await store.put(metadata);

  let attempts = 0;
  let offset = metadata.confirmedOffset;

  while (offset < data.length) {
    const chunkIndex = Math.floor(offset / metadata.chunkSize);
    const chunk = metadata.chunks[chunkIndex];
    const end = Math.min(offset + metadata.chunkSize, data.length);
    const slice = data.slice(offset, end);

    try {
      const { confirmedOffset } = await server.uploadChunk(metadata.uploadId, offset, slice);
      // Guard against a server that reports an offset we did not send.
      if (confirmedOffset !== end) {
        throw new Error(`offset mismatch: expected ${end}, got ${confirmedOffset}`);
      }
      offset = confirmedOffset;
      metadata.confirmedOffset = offset;
      if (chunk) {
        chunk.quarantined = false;
      }
      metadata.updatedAt = Date.now();
      await store.put(metadata);
    } catch (err) {
      attempts += 1;
      if (chunk) {
        chunk.attempts += 1;
        chunk.quarantined = true;
      }
      metadata.status = 'quarantined';
      metadata.updatedAt = Date.now();
      await store.put(metadata);

      if (attempts >= MAX_CHUNK_ATTEMPTS) {
        metadata.status = 'failed';
        await store.put(metadata);
        return {
          status: 'failed',
          confirmedOffset: metadata.confirmedOffset,
          verified: false,
          attempts,
        };
      }
    }
  }

  // Integrity verification: a hash mismatch must never mark the record uploaded.
  const remoteHash = await server.getObjectHash(metadata.uploadId);
  if (remoteHash !== metadata.localHash) {
    metadata.status = 'failed';
    metadata.updatedAt = Date.now();
    await store.put(metadata);
    return {
      status: 'failed',
      confirmedOffset: metadata.confirmedOffset,
      verified: false,
      attempts,
    };
  }

  metadata.status = 'completed';
  metadata.updatedAt = Date.now();
  await store.put(metadata);
  return {
    status: 'completed',
    confirmedOffset: metadata.confirmedOffset,
    verified: true,
    attempts,
  };
}

/**
 * Removes only the given account's pending upload metadata. Used on logout or
 * account switch so other accounts' uploads are untouched.
 */
export async function clearAccountUploads(
  accountId: string,
  store: UploadMetadataStore,
): Promise<number> {
  const pending = await store.listByAccount(accountId);
  for (const item of pending) {
    await store.remove(item.uploadId);
  }
  return pending.length;
}

/** Platform hint retained for callers that branch on runtime. */
export const isMobilePlatform = Platform.OS === 'ios' || Platform.OS === 'android';
