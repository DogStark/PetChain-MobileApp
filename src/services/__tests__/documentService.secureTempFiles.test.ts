/**
 * documentService.secureTempFiles.test.ts — #966 secure temporary files
 *
 * Tests cover:
 *  - saveDocumentLocally writes to cacheDirectory (private, no backup)
 *  - Filename includes a random UUID component (≠ plain originalName)
 *  - Two successive calls with the same name produce different paths
 *  - cleanupTempFile deletes the file and is idempotent (no throw on missing)
 *  - Regression: the old behaviour (plain filename in cacheDirectory) is
 *    explicitly NOT reproduced — ensures the secure path is used.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-file-system', () => ({
  cacheDirectory: '/mock/cache/',
  documentDirectory: '/mock/documents/',
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  readAsStringAsync: jest.fn().mockResolvedValue('bW9ja2ZpbGVjb250ZW50'),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, isDirectory: false, size: 1024 }),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn().mockResolvedValue({
    uri: '/mock/thumb.jpg',
    width: 200,
    height: 200,
    base64: 'bW9ja3RodW1ibmFpbA==',
  }),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

jest.mock('../apiClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import CryptoJS from 'crypto-js';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import apiClient from '../apiClient';
import { saveDocumentLocally, cleanupTempFile, downloadDocument } from '../documentService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockFileSystem = FileSystem as jest.Mocked<typeof FileSystem>;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

const TEST_KEY = CryptoJS.lib.WordArray.random(32).toString();
const TEST_KEY_VERSION = 1;

function setupKey() {
  mockSecureStore.getItemAsync.mockImplementation(async (key: string) => {
    if (key === 'com.petchain.docvault.keyVersion') return String(TEST_KEY_VERSION);
    if (key === `com.petchain.docvault.key.${TEST_KEY_VERSION}`) return TEST_KEY;
    return null;
  });
}

function makeMockDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    petId: 'pet-1',
    ownerId: 'owner-1',
    name: 'test.pdf',
    category: 'vaccination',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    iv: 'a'.repeat(24),
    tag: 'b'.repeat(64),
    keyVersion: 1,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Encrypt a plaintext string to simulate a server response */
function encryptForServer(plaintext: string) {
  const key = TEST_KEY;
  const iv = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
  const encrypted = CryptoJS.AES.encrypt(plaintext, CryptoJS.enc.Hex.parse(key), {
    iv: CryptoJS.enc.Hex.parse(iv),
  });
  const encryptedContent = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  const tag = CryptoJS.HmacSHA256(`${iv}:${encryptedContent}`, key).toString(CryptoJS.enc.Hex);
  return { encryptedContent, iv, tag, keyVersion: TEST_KEY_VERSION };
}

function setupDownloadMock(plaintext = 'SGVsbG8=') {
  const { encryptedContent, iv, tag, keyVersion } = encryptForServer(plaintext);
  mockApiClient.get.mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        ...makeMockDoc(),
        encryptedContent,
        iv,
        tag,
        keyVersion,
      },
    },
  });
  return plaintext;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('saveDocumentLocally — secure temp path (issue #966)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient.get.mockReset();
    setupKey();
  });

  it('writes the file inside cacheDirectory', async () => {
    setupDownloadMock();
    const uri = await saveDocumentLocally('doc-1', 'report.pdf');
    expect(uri).toContain('/mock/cache/');
  });

  it('includes a random UUID token in the filename (not just the plain name)', async () => {
    setupDownloadMock();
    const uri = await saveDocumentLocally('doc-1', 'report.pdf');
    // The path should NOT equal the simple concatenation
    expect(uri).not.toBe('/mock/cache/report.pdf');
    // Should still end with the original filename
    expect(uri).toMatch(/report\.pdf$/);
  });

  it('generates a different path on each call for the same filename', async () => {
    setupDownloadMock();
    setupDownloadMock();

    const uri1 = await saveDocumentLocally('doc-1', 'report.pdf');

    // Reset the api mock for the second call
    mockApiClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          ...makeMockDoc(),
          ...encryptForServer('SGVsbG8='),
        },
      },
    });

    const uri2 = await saveDocumentLocally('doc-1', 'report.pdf');
    expect(uri1).not.toBe(uri2);
  });

  it('does NOT use the plain filename directly (old insecure behaviour)', async () => {
    setupDownloadMock();
    const uri = await saveDocumentLocally('doc-1', 'secret.pdf');
    // The old code would have produced exactly this path
    expect(uri).not.toBe('/mock/cache/secret.pdf');
  });

  it('sanitises directory separators in the original name', async () => {
    setupDownloadMock();
    const uri = await saveDocumentLocally('doc-1', '../../../etc/passwd');
    // Should not contain raw directory traversal
    expect(uri).not.toContain('../');
    // Should still be under cacheDirectory
    expect(uri).toContain('/mock/cache/');
  });

  it('writes decrypted content to the secure path', async () => {
    const plaintext = setupDownloadMock('SGVsbG8gV29ybGQ=');
    const uri = await saveDocumentLocally('doc-1', 'report.pdf');
    expect(mockFileSystem.writeAsStringAsync).toHaveBeenCalledWith(uri, plaintext, {
      encoding: FileSystem.EncodingType.Base64,
    });
  });
});

describe('cleanupTempFile (issue #966)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls FileSystem.deleteAsync with idempotent:true', async () => {
    mockFileSystem.deleteAsync.mockResolvedValueOnce(undefined);
    await cleanupTempFile('/mock/cache/abc123_report.pdf');
    expect(mockFileSystem.deleteAsync).toHaveBeenCalledWith('/mock/cache/abc123_report.pdf', {
      idempotent: true,
    });
  });

  it('does not throw when the file does not exist', async () => {
    mockFileSystem.deleteAsync.mockRejectedValueOnce(new Error('File not found'));
    // Should resolve without throwing
    await expect(cleanupTempFile('/mock/cache/gone.pdf')).resolves.toBeUndefined();
  });

  it('can be called multiple times on the same path without error', async () => {
    mockFileSystem.deleteAsync.mockResolvedValue(undefined);
    await cleanupTempFile('/mock/cache/file.pdf');
    await cleanupTempFile('/mock/cache/file.pdf');
    expect(mockFileSystem.deleteAsync).toHaveBeenCalledTimes(2);
  });
});

describe('secure temp file — background/foreground lifecycle', () => {
  it('the returned URI can be passed to cleanupTempFile to remove the file', async () => {
    setupKey();
    setupDownloadMock();
    mockFileSystem.deleteAsync.mockResolvedValueOnce(undefined);

    const uri = await saveDocumentLocally('doc-1', 'document.pdf');
    await cleanupTempFile(uri);

    expect(mockFileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
  });
});
