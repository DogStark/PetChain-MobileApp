import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

/**
 * Offline attachment upload with resume + integrity verification (issue #1061).
 *
 * Resumable upload metadata is stored separately from the medical record so
 * record persistence is never coupled to in-flight upload state. A record is
 * only marked uploaded after the completed object hash matches the expected
 * hash. Interrupted uploads resume from the server-confirmed offset, and
 * failed chunks are quarantined for bounded, user-visible retry.
 */

export type UploadStatus =
  | 'pending'
  | 'uploading'
  | 'paused'
  | 'quarantined'
  | 'verifying'
  | 'uploaded'
  | 'failed';

export interface UploadChunk {
  index: number;
  start: number;
  end: number;
  data: string;
}

export interface UploadMetadata {
  uploadId: string;
  accountId: string;
  recordId: string;
  fileName: string;
  totalBytes: number;
  chunkSize: number;
  expectedHash: string;
  confirmedOffset: number;
  status: UploadStatus;
  attempts: number;
  quarantinedChunks: number[];
  updatedAt: number;
}

export interface ChunkServer {
  /** Returns the server-confirmed byte offset for an upload. */
  getOffset(uploadId: string): Promise<number>;
  /** Uploads a single chunk; resolves with the new confirmed offset. */
  putChunk(uploadId: string, chunk: UploadChunk): Promise<number>;
  /** Finalizes the object and returns its server-computed hash. */
  complete(uploadId: string): Promise<{ hash: string }>;
}

/** Metadata store kept separate from the medical record store. */
export interface UploadMetadataStore {
  load(accountId: string): Promise<UploadMetadata[]>;
  save(meta: UploadMetadata): Promise<void>;
  remove(uploadId: string): Promise<void>;
  removeForAccount(accountId: string): Promise<void>;
}

export const MAX_UPLOAD_ATTEMPTS = 3;

/** Deterministic content hash used to verify a completed object. */
export function hashObject(data: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < data.length; i += 1) {
    const ch = data.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Splits an object into fixed-size chunks for resumable transfer. */
export function splitIntoChunks(data: string, chunkSize: number): UploadChunk[] {
  const chunks: UploadChunk[] = [];
  for (let start = 0, index = 0; start < data.length; start += chunkSize, index += 1) {
    const end = Math.min(start + chunkSize, data.length);
    chunks.push({ index, start, end, data: data.slice(start, end) });
  }
  return chunks;
}

/**
 * Resumes an upload from the server-confirmed offset. Chunks already covered by
 * the confirmed offset are skipped; failed chunks are quarantined for retry.
 * The record is only marked uploaded when the final hash matches.
 */
export async function resumeUpload(
  meta: UploadMetadata,
  objectData: string,
  server: ChunkServer,
  store: UploadMetadataStore,
): Promise<UploadMetadata> {
  const confirmedOffset = await server.getOffset(meta.uploadId);
  let current: UploadMetadata = {
    ...meta,
    confirmedOffset,
    status: 'uploading',
    attempts: meta.attempts + 1,
    updatedAt: Date.now(),
  };
  await store.save(current);

  const chunks = splitIntoChunks(objectData, meta.chunkSize);
  const quarantined: number[] = [];

  for (const chunk of chunks) {
    if (chunk.end <= current.confirmedOffset) {
      continue;
    }
    try {
      const newOffset = await server.putChunk(meta.uploadId, chunk);
      current = { ...current, confirmedOffset: newOffset, updatedAt: Date.now() };
      await store.save(current);
    } catch (err) {
      quarantined.push(chunk.index);
    }
  }

  if (quarantined.length > 0) {
    current = {
      ...current,
      status: 'quarantined',
      quarantinedChunks: quarantined,
      updatedAt: Date.now(),
    };
    await store.save(current);
    return current;
  }

  current = { ...current, status: 'verifying', updatedAt: Date.now() };
  await store.save(current);

  const { hash } = await server.complete(meta.uploadId);
  if (hash !== meta.expectedHash) {
    // Hash mismatch: never mark the record uploaded.
    current = { ...current, status: 'failed', updatedAt: Date.now() };
    await store.save(current);
    return current;
  }

  current = { ...current, status: 'uploaded', quarantinedChunks: [], updatedAt: Date.now() };
  await store.save(current);
  return current;
}

/** Removes only the current account's pending upload metadata on logout. */
export async function clearAccountUploads(
  accountId: string,
  store: UploadMetadataStore,
): Promise<void> {
  await store.removeForAccount(accountId);
}

interface AttachmentUploadScreenProps {
  accountId: string;
  recordId: string;
  fileName: string;
  objectData: string;
  expectedHash: string;
  chunkSize?: number;
  server: ChunkServer;
  store: UploadMetadataStore;
  onUploaded?: (meta: UploadMetadata) => void;
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  pending: 'Pending',
  uploading: 'Uploading…',
  paused: 'Paused',
  quarantined: 'Some chunks failed — retry available',
  verifying: 'Verifying integrity…',
  uploaded: 'Uploaded & verified',
  failed: 'Integrity check failed',
};

export default function AttachmentUploadScreen({
  accountId,
  recordId,
  fileName,
  objectData,
  expectedHash,
  chunkSize = 64 * 1024,
  server,
  store,
  onUploaded,
}: AttachmentUploadScreenProps) {
  const [meta, setMeta] = useState<UploadMetadata | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const uploadId = useMemo(
    () => `${accountId}:${recordId}:${fileName}`,
    [accountId, recordId, fileName],
  );

  const runResume = useCallback(
    async (base: UploadMetadata) => {
      setBusy(true);
      try {
        const next = await resumeUpload(base, objectData, server, store);
        if (!mounted.current) {
          return;
        }
        setMeta(next);
        if (next.status === 'uploaded') {
          onUploaded?.(next);
        } else if (next.status === 'failed') {
          Alert.alert('Upload failed', 'The uploaded object did not match its expected hash.');
        } else if (next.status === 'quarantined') {
          Alert.alert(
            'Upload interrupted',
            `${next.quarantinedChunks.length} chunk(s) failed and were quarantined for retry.`,
          );
        }
      } finally {
        if (mounted.current) {
          setBusy(false);
        }
      }
    },
    [objectData, server, store, onUploaded],
  );

  const handleStart = useCallback(async () => {
    const initial: UploadMetadata = {
      uploadId,
      accountId,
      recordId,
      fileName,
      totalBytes: objectData.length,
      chunkSize,
      expectedHash,
      confirmedOffset: 0,
      status: 'pending',
      attempts: 0,
      quarantinedChunks: [],
      updatedAt: Date.now(),
    };
    await store.save(initial);
    setMeta(initial);
    await runResume(initial);
  }, [uploadId, accountId, recordId, fileName, objectData, chunkSize, expectedHash, store, runResume]);

  const handleRetry = useCallback(async () => {
    if (!meta) {
      return;
    }
    if (meta.attempts >= MAX_UPLOAD_ATTEMPTS) {
      Alert.alert('Retry limit reached', 'This upload has exceeded the maximum number of attempts.');
      return;
    }
    await runResume(meta);
  }, [meta, runResume]);

  const retriesRemaining = meta ? Math.max(0, MAX_UPLOAD_ATTEMPTS - meta.attempts) : MAX_UPLOAD_ATTEMPTS;
  const canRetry =
    !!meta &&
    (meta.status === 'quarantined' || meta.status === 'failed' || meta.status === 'paused') &&
    retriesRemaining > 0;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Attachment upload</Text>
      <Text style={styles.fileName}>{fileName}</Text>

      {meta ? (
        <View style={styles.statusBox}>
          <Text style={styles.status}>{STATUS_LABEL[meta.status]}</Text>
          <Text style={styles.detail}>
            {meta.confirmedOffset} / {meta.totalBytes} bytes confirmed
          </Text>
          <Text style={styles.detail}>
            Attempts: {meta.attempts} · Retries remaining: {retriesRemaining}
          </Text>
          {meta.quarantinedChunks.length > 0 ? (
            <Text style={styles.detail}>
              Quarantined chunks: {meta.quarantinedChunks.join(', ')}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.detail}>No upload in progress.</Text>
      )}

      {busy ? <ActivityIndicator style={styles.spinner} /> : null}

      {!meta ? (
        <TouchableOpacity style={styles.button} onPress={handleStart} disabled={busy}>
          <Text style={styles.buttonText}>Start upload</Text>
        </TouchableOpacity>
      ) : null}

      {canRetry ? (
        <TouchableOpacity style={styles.button} onPress={handleRetry} disabled={busy}>
          <Text style={styles.buttonText}>Retry upload</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  title: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  fileName: { fontSize: 14, color: '#555', marginBottom: 12 },
  statusBox: { marginBottom: 12 },
  status: { fontSize: 16, fontWeight: '500', marginBottom: 4 },
  detail: { fontSize: 13, color: '#666' },
  spinner: { marginVertical: 12 },
  button: {
    backgroundColor: '#2f6fed',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
