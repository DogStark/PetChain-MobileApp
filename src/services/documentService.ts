import CryptoJS from 'crypto-js';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';

import apiClient from './apiClient';
import { logError } from '../utils/errorLogger';

// ─── Types ────────────────────────────────────────────────────────────────────

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

export interface UploadDocumentParams {
  petId: string;
  name: string;
  category: DocumentCategory;
  /** URI from file picker or camera */
  uri: string;
  mimeType: string;
  /** If provided, creates a new version of this document */
  parentId?: string;
}

export interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KEY_VERSION_KEY = 'com.petchain.docvault.keyVersion';
const KEY_MATERIAL_PREFIX = 'com.petchain.docvault.key.';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const THUMBNAIL_SIZE = 200;
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

// ─── Key management ───────────────────────────────────────────────────────────

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

// ─── Encryption ───────────────────────────────────────────────────────────────

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

// ─── Thumbnail generation ─────────────────────────────────────────────────────

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

// ─── File validation ──────────────────────────────────────────────────────────

function validateMimeType(mimeType: string): void {
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}. Allowed: ${[...ALLOWED_MIME].join(', ')}`);
  }
}

function validateSize(sizeBytes: number): void {
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large: ${sizeBytes} bytes. Maximum: ${MAX_UPLOAD_BYTES} bytes`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Pick a document from the file system. */
export async function pickDocument(): Promise<{
  uri: string;
  name: string;
  mimeType: string;
  size: number;
} | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
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

/** Encrypt and upload a document to the backend. */
export async function uploadDocument(params: UploadDocumentParams): Promise<DocumentMeta> {
  validateMimeType(params.mimeType);

  const fileInfo = await FileSystem.getInfoAsync(params.uri);
  if (!fileInfo.exists || fileInfo.isDirectory) throw new Error('File not found');
  const sizeBytes = fileInfo.size ?? 0;
  validateSize(sizeBytes);

  // Read file as base64
  const plainBase64 = await FileSystem.readAsStringAsync(params.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Encrypt content
  const { encryptedContent, iv, tag, keyVersion } = await encryptContent(plainBase64);

  // Generate encrypted thumbnail for images
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

  const response = await apiClient.post<{ success: boolean; data: DocumentMeta }>(
    '/api/documents',
    body,
  );
  return response.data.data;
}

/** Download and decrypt a document, returning the plaintext base64 content. */
export async function downloadDocument(documentId: string): Promise<string> {
  const response = await apiClient.get<{ success: boolean; data: DocumentWithContent }>(
    `/api/documents/${documentId}`,
  );
  const doc = response.data.data;
  return decryptContent(doc.encryptedContent, doc.iv, doc.tag, doc.keyVersion);
}

// ─── Secure temp-file helpers (issue #966) ───────────────────────────────────
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
  // Use crypto-js to generate a random UUID-like token (8 hex bytes)
  const token = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
  // Strip directory separators from the original name to prevent path traversal
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
