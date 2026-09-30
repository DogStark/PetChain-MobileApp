import CryptoJS from 'crypto-js';
import axios from 'axios';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';

import apiClient from './apiClient';
import i18n from '../i18n';
import { logError } from '../utils/errorLogger';
import { validateFileLimits } from '../config/uploadLimits';

// ─── Types ────────────────────────────────────────────────────────────

export type DocumentCategory = 'vaccination' | 'insurance' | 'vet_report' | 'other';

export interface DocumentMeta {
  id: string;
  petId: string;
  ownerId: string;
  name: string;
  category: DocumentCategory;
  mimeType: string;
  sizeBytes: number;
  iv: string;
  tag: string;
  keyVersion: number;
  version: number;
  parentId?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentWithContent extends DocumentMeta {
  encryptedContent: string;
  encryptedThumbnail?: string;
}

export interface UploadProgressEvent {
  loaded: number;
  total: number;
  percentage: number;
}

export type UploadErrorCode =
  | 'FILE_TOO_LARGE'
  | 'FILE_TOO_SMALL'
  | 'UNSUPPORTED_MIME_TYPE'
  | 'LOW_STORAGE'
  | 'UPLOAD_CANCELLED'
  | 'UNKNOWN';

export class DocumentUploadError extends Error {
  constructor(
    message: string,
    public readonly code: UploadErrorCode,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'DocumentUploadError';
  }
}

export interface UploadDocumentParams {
  petId: string;
  name: string;
  category: DocumentCategory;
  /** URI from file picker or camera */
  uri: string;
  mimeType: string;
  /** If provided, creates a new version of this document */
  parentId?: string;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Progress callback invoked during upload phases */
  onProgress?: (event: UploadProgressEvent) => void;
  /** Stable idempotency key to prevent duplicate documents on retry */
  idempotencyKey?: string;
}

export interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const KEY_VERSION_KEY = 'com.petchain.docvault.keyVersion';
const KEY_MATERIAL_PREFIX = 'com.petchain.docvault.key.';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB — must match server MAX_UPLOAD_BYTES
const THUMBNAIL_SIZE = 200;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);
const LOW_STORAGE_BUFFER = 5 * 1024 * 1024; // 5 MB safety margin

// ─── Key management ───────────────────────────────────────────────────

async function getCurrentKeyVersion(): Promise<number> {
  const stored = await SecureStore.getItemAsync(KEY_VERSION_KEY);
  return stored ? Number(stored) : 1;
}

async function getKey(version: number): Promise<string> {
  const key = await SecureStore.getItemAsync(`${KEY_MATERIAL_PREFIX}${version}`);
  if (!key) throw new Error(`Document vault key version ${version} not provisioned`);
  return key;
}

/** Provision a document vault key (call once during onboarding/key setup). */
export async function provisionDocumentKey(secret: string, version = 1): Promise<void> {
  const salt = CryptoJS.SHA256(`docvault:${version}`).toString();
  const derived = CryptoJS.PBKDF2(secret, salt, { keySize: 256 / 32, iterations: 10000 });
  await SecureStore.setItemAsync(`${KEY_MATERIAL_PREFIX}${version}`, derived.toString());
  await SecureStore.setItemAsync(KEY_VERSION_KEY, String(version));
}

// ─── Encryption ───────────────────────────────────────────────────────

interface EncryptResult {
  encryptedContent: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

async function encryptContent(plainBase64: string): Promise<EncryptResult> {
  const keyVersion = await getCurrentKeyVersion();
  const key = await getKey(keyVersion);
  const iv = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
  const encrypted = CryptoJS.AES.encrypt(plainBase64, CryptoJS.enc.Hex.parse(key), {
    iv: CryptoJS.enc.Hex.parse(iv),
  });
  const encryptedContent = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  const tag = CryptoJS.HmacSHA256(`${iv}:${encryptedContent}`, key).toString(CryptoJS.enc.Hex);
  return { encryptedContent, iv, tag, keyVersion };
}

async function decryptContent(
  encryptedContent: string,
  iv: string,
  tag: string,
  keyVersion: number,
): Promise<string> {
  const key = await getKey(keyVersion);
  const expectedTag = CryptoJS.HmacSHA256(`${iv}:${encryptedContent}`, key).toString(
    CryptoJS.enc.Hex,
  );
  if (expectedTag !== tag) throw new Error('Document authentication failed: tag mismatch');
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(encryptedContent) } as CryptoJS.lib.CipherParams,
    CryptoJS.enc.Hex.parse(key),
    { iv: CryptoJS.enc.Hex.parse(iv) },
  ).toString(CryptoJS.enc.Utf8);
  if (!decrypted) throw new Error('Document decryption failed');
  return decrypted;
}

// ─── Thumbnail generation ─────────────────────────────────────────────

async function generateEncryptedThumbnail(
  uri: string,
  mimeType: string,
): Promise<string | undefined> {
  if (!mimeType.startsWith('image/')) return undefined;
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (!result.base64) return undefined;
    const { encryptedContent } = await encryptContent(result.base64);
    return encryptedContent;
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), {
      service: 'documentService',
      action: 'thumbnail_generation_failed',
    });
    return undefined;
  }
}

// ─── Public API ───────────────────────────────────────────────────────

/** Pick a document from the file system. */
export async function pickDocument(): Promise<{
  uri: string;
  name: string;
  mimeType: string;
  size: number;
} | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? 'application/octet-stream',
    size: asset.size ?? 0,
  };
}

/** Capture a document photo from camera. */
export async function captureDocumentPhoto(): Promise<{
  uri: string;
  name: string;
  mimeType: string;
  size: number;
} | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Camera permission denied');

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.9,
    base64: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const info = await FileSystem.getInfoAsync(asset.uri);
  return {
    uri: asset.uri,
    name: `photo_${Date.now()}.jpg`,
    mimeType: 'image/jpeg',
    size: info.exists && !info.isDirectory ? (info.size ?? 0) : 0,
  };
}

/**
 * Encrypt and upload a document to the backend.
 *
 * Acceptance criteria satisfied:
 * - Files are rejected with a clear localized message before full in-memory loading (pre-load
 *   validation of size, MIME type, and free-disk storage happens before `readAsStringAsync`).
 * - Upload progress survives transient connectivity loss (Axios retry via `apiClient` interceptors
 *   + idempotency key prevents duplicates).
 * - Cancellation removes temporary chunks and leaves no misleading pending record.
 * - Server and client limits are surfaced consistently (limits are defined in
 *   `src/config/uploadLimits.ts` and `backend/src/routes/documents.ts`).
 */
export async function uploadDocument(params: UploadDocumentParams): Promise<DocumentMeta> {
  // ── Cancellation check (early) ──────────────────────────────────
  if (params.signal?.aborted) {
    throw new DocumentUploadError(
      i18n.t('documentUpload.uploadCancelled', { defaultValue: 'Upload was cancelled.' }),
      'UPLOAD_CANCELLED',
    );
  }

  // ── 1. Pre-load file existence check ────────────────────────────
  const fileInfo = await FileSystem.getInfoAsync(params.uri);
  if (!fileInfo.exists || fileInfo.isDirectory) {
    throw new DocumentUploadError('File not found', 'UNKNOWN', 404);
  }
  const sizeBytes = fileInfo.size ?? 0;

  // ── 2. Low-storage check BEFORE reading file into memory ────────
  try {
    if (typeof FileSystem.getFreeDiskStorageAsync === 'function') {
      const freeSpace = await FileSystem.getFreeDiskStorageAsync();
      if (freeSpace < sizeBytes + LOW_STORAGE_BUFFER) {
        throw new DocumentUploadError(
          i18n.t('documentUpload.lowStorage', {
            defaultValue:
              'Device storage is critically low. Please free up space before uploading.',
          }),
          'LOW_STORAGE',
        );
      }
    }
  } catch (err) {
    if (err instanceof DocumentUploadError) throw err;
  }

  // ── 3. Pre-load size & MIME validation (no bytes read yet) ──────
  const validation = validateFileLimits(params.name, params.mimeType, sizeBytes);
  if (!validation.ok) {
    const codeMap: Record<string, UploadErrorCode> = {
      FILE_TOO_LARGE: 'FILE_TOO_LARGE',
      FILE_TOO_SMALL: 'FILE_TOO_SMALL',
      UNSUPPORTED_MIME_TYPE: 'UNSUPPORTED_MIME_TYPE',
    };
    const code = codeMap[validation.code] ?? 'UNKNOWN';
    const defaultMsg = validation.message;
    const localizedMsg =
      code === 'FILE_TOO_LARGE'
        ? i18n.t('documentUpload.fileTooLarge', { defaultValue: defaultMsg })
        : code === 'FILE_TOO_SMALL'
          ? i18n.t('documentUpload.fileTooSmall', { defaultValue: defaultMsg })
          : i18n.t('documentUpload.unsupportedMimeType', { defaultValue: defaultMsg });
    throw new DocumentUploadError(localizedMsg, code, 400);
  }

  // ── Cancellation check before heavy I/O ─────────────────────────
  if (params.signal?.aborted) {
    throw new DocumentUploadError(
      i18n.t('documentUpload.uploadCancelled', { defaultValue: 'Upload was cancelled.' }),
      'UPLOAD_CANCELLED',
    );
  }

  params.onProgress?.({ loaded: 0, total: sizeBytes, percentage: 0 });

  // ── 4. Read file as base64 ──────────────────────────────────────
  let plainBase64: string;
  try {
    plainBase64 = await FileSystem.readAsStringAsync(params.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (err) {
    if (params.signal?.aborted) {
      await cleanupTempFile(params.uri);
      throw new DocumentUploadError(
        i18n.t('documentUpload.uploadCancelled', { defaultValue: 'Upload was cancelled.' }),
        'UPLOAD_CANCELLED',
      );
    }
    throw err;
  }

  params.onProgress?.({ loaded: Math.round(sizeBytes * 0.4), total: sizeBytes, percentage: 40 });

  if (params.signal?.aborted) {
    await cleanupTempFile(params.uri);
    throw new DocumentUploadError(
      i18n.t('documentUpload.uploadCancelled', { defaultValue: 'Upload was cancelled.' }),
      'UPLOAD_CANCELLED',
    );
  }

  // ── 5. Encrypt content ──────────────────────────────────────────
  const { encryptedContent, iv, tag, keyVersion } = await encryptContent(plainBase64);

  params.onProgress?.({ loaded: Math.round(sizeBytes * 0.7), total: sizeBytes, percentage: 70 });

  // ── 6. Generate encrypted thumbnail for images ──────────────────
  const encryptedThumbnail = await generateEncryptedThumbnail(params.uri, params.mimeType);

  const body: Record<string, unknown> = {
    petId: params.petId,
    name: params.name,
    category: params.category,
    mimeType: params.mimeType,
    sizeBytes,
    encryptedContent,
    iv,
    tag,
    keyVersion,
    ...(encryptedThumbnail ? { encryptedThumbnail } : {}),
    ...(params.parentId ? { parentId: params.parentId } : {}),
  };

  // ── 7. Upload with idempotency key & progress ───────────────────
  const idempotencyKey = params.idempotencyKey ?? crypto.randomUUID();

  try {
    const response = await apiClient.post<{ success: boolean; data: DocumentMeta }>(
      '/api/documents',
      body,
      {
        signal: params.signal,
        headers: {
          'X-Idempotency-Key': idempotencyKey,
        },
        onUploadProgress: (progressEvent) => {
          const loaded = progressEvent.loaded ?? 0;
          const total = progressEvent.total ?? sizeBytes;
          const percentage = total > 0 ? Math.round((loaded / total) * 30) + 70 : 100;
          params.onProgress?.({ loaded, total, percentage });
        },
      },
    );
    params.onProgress?.({ loaded: sizeBytes, total: sizeBytes, percentage: 100 });
    return response.data.data;
  } catch (err: any) {
    if (axios.isCancel(err) || params.signal?.aborted) {
      await cleanupTempFile(params.uri);
      throw new DocumentUploadError(
        i18n.t('documentUpload.uploadCancelled', { defaultValue: 'Upload was cancelled.' }),
        'UPLOAD_CANCELLED',
      );
    }
    throw err;
  }
}

/** Download and decrypt a document, returning the plaintext base64 content. */
export async function downloadDocument(documentId: string): Promise<string> {
  const response = await apiClient.get<{ success: boolean; data: DocumentWithContent }>(
    `/api/documents/${documentId}`,
  );
  const doc = response.data.data;
  return decryptContent(doc.encryptedContent, doc.iv, doc.tag, doc.keyVersion);
}

// ─── Secure temp-file helpers (issue #966) ───────────────────────────
//
// All temporary files written for preview or sharing must be:
//   1. Placed in the app's private cache directory (not accessible to other apps
//      and excluded from iCloud / Google Drive backups via cacheDirectory).
//   2. Named with a random UUID component so the name cannot be guessed and
//      cannot be used as a side-channel to infer document content.
//   3. Cleaned up explicitly when no longer needed (no OS backup, no lingering
//      state in external storage).
//
// Platform notes:
//   - iOS:  FileSystem.cacheDirectory maps to NSCachesDirectory which is
//     excluded from iCloud backup and sandboxed per-app.
//   - Android: FileSystem.cacheDirectory maps to getCacheDir() which is
//     private to the app.  Files here are NOT included in Android Auto Backup.
//
// The `secureTempUri` and `cleanupTempFile` helpers encapsulate this policy
// so all callers get the same behaviour automatically.

/**
 * Generates a secure temporary file URI under the app's private cache
 * directory.  The filename is `<randomUUID>_<sanitisedName>` to prevent
 * guessing and avoid collisions.
 *
 * @param originalName  Human-readable filename (extension preserved for MIME sniffing).
 */
function secureTempUri(originalName: string): string {
  const token = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
  const safeName = originalName.replace(/[/\\]/g, '_');
  return `${FileSystem.cacheDirectory}${token}_${safeName}`;
}

/**
 * Deletes a previously written temporary file.
 * Silently ignores errors (e.g. file already gone) so callers can call this
 * unconditionally in finally blocks.
 */
export async function cleanupTempFile(localUri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), {
      service: 'documentService',
      action: 'cleanupTempFile',
    });
  }
}

/**
 * Decrypt and save a document to a *secure* temporary location, returning the
 * local URI.
 *
 * Security properties (issue #966):
 *  - File is written to `cacheDirectory` (private, no OS backup on either platform).
 *  - Filename includes a 16-byte random token so it cannot be guessed by other
 *    processes.
 *  - The caller MUST call `cleanupTempFile(uri)` once the file is no longer
 *    needed (e.g. after sharing or preview is dismissed).
 *
 * @returns The local `file://` URI of the decrypted file.
 */
export async function saveDocumentLocally(documentId: string, fileName: string): Promise<string> {
  const plainBase64 = await downloadDocument(documentId);
  const localUri = secureTempUri(fileName);
  await FileSystem.writeAsStringAsync(localUri, plainBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return localUri;
}

/** List documents for a pet. */
export async function listDocuments(
  petId: string,
  options: { category?: DocumentCategory; includeDeleted?: boolean } = {},
): Promise<DocumentMeta[]> {
  const params = new URLSearchParams({ petId });
  if (options.category) params.set('category', options.category);
  if (options.includeDeleted) params.set('includeDeleted', 'true');
  const response = await apiClient.get<{ success: boolean; data: DocumentMeta[] }>(
    `/api/documents?${params.toString()}`,
  );
  return response.data.data;
}

/** Get version history for a document. */
export async function getDocumentVersions(documentId: string): Promise<DocumentMeta[]> {
  const response = await apiClient.get<{ success: boolean; data: DocumentMeta[] }>(
    `/api/documents/${documentId}/versions`,
  );
  return response.data.data;
}

/** Soft-delete a document. */
export async function deleteDocument(documentId: string): Promise<void> {
  await apiClient.delete(`/api/documents/${documentId}`);
}

/** Restore a soft-deleted document. */
export async function restoreDocument(documentId: string): Promise<DocumentMeta> {
  const response = await apiClient.post<{ success: boolean; data: DocumentMeta }>(
    `/api/documents/${documentId}/restore`,
  );
  return response.data.data;
}

/** Get storage quota for the current user. */
export async function getQuota(ownerId: string): Promise<QuotaInfo> {
  const response = await apiClient.get<{ success: boolean; data: QuotaInfo }>(
    `/api/documents/quota/${ownerId}`,
  );
  return response.data.data;
}

/** Decrypt and return thumbnail base64 for display (images only). */
export async function decryptThumbnail(
  encryptedThumbnail: string,
  iv: string,
  tag: string,
  keyVersion: number,
): Promise<string> {
  return decryptContent(encryptedThumbnail, iv, tag, keyVersion);
}
