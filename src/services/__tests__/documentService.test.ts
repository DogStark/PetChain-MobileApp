jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: '/mock/documents/',
  cacheDirectory: '/mock/cache/',
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

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import CryptoJS from 'crypto-js';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';

import apiClient from '../apiClient';
import {
  provisionDocumentKey,
  uploadDocument,
  downloadDocument,
  saveDocumentLocally,
  listDocuments,
  getDocumentVersions,
  deleteDocument,
  restoreDocument,
  getQuota,
  pickDocument,
  captureDocumentPhoto,
} from '../documentService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockFileSystem = FileSystem as jest.Mocked<typeof FileSystem>;
const mockDocumentPicker = DocumentPicker as jest.Mocked<typeof DocumentPicker>;
const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const mockImageManipulator = ImageManipulator as jest.Mocked<typeof ImageManipulator>;

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('provisionDocumentKey', () => {
  it('derives and stores a key', async () => {
    await provisionDocumentKey('my-secret', 1);
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'com.petchain.docvault.key.1',
      expect.any(String),
    );
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'com.petchain.docvault.keyVersion',
      '1',
    );
  });

  it('produces different keys for different secrets', async () => {
    const calls: string[] = [];
    mockSecureStore.setItemAsync.mockImplementation(async (k, v) => {
      if (k === 'com.petchain.docvault.key.1') calls.push(v as string);
    });
    await provisionDocumentKey('secret-a', 1);
    await provisionDocumentKey('secret-b', 1);
    expect(calls[0]).not.toBe(calls[1]);
  });
});

describe('uploadDocument', () => {
  beforeEach(() => {
    setupKey();
    mockApiClient.post.mockResolvedValue({
      data: { success: true, data: makeMockDoc() },
    });
  });

  it('encrypts content before upload', async () => {
    await uploadDocument({
      petId: 'pet-1',
      name: 'test.pdf',
      category: 'vaccination',
      uri: '/mock/file.pdf',
      mimeType: 'application/pdf',
    });

    const callBody = mockApiClient.post.mock.calls[0][1] as Record<string, unknown>;
    // Encrypted content should not equal the raw base64
    expect(callBody.encryptedContent).toBeDefined();
    expect(callBody.encryptedContent).not.toBe('bW9ja2ZpbGVjb250ZW50');
    expect(callBody.iv).toBeDefined();
    expect(callBody.tag).toBeDefined();
    expect(callBody.keyVersion).toBe(1);
  });

  it('never sends plaintext content to backend', async () => {
    await uploadDocument({
      petId: 'pet-1',
      name: 'test.pdf',
      category: 'vaccination',
      uri: '/mock/file.pdf',
      mimeType: 'application/pdf',
    });

    const callBody = mockApiClient.post.mock.calls[0][1] as Record<string, unknown>;
    // The raw file content should not appear in the request
    expect(JSON.stringify(callBody)).not.toContain('bW9ja2ZpbGVjb250ZW50');
  });

  it('generates encrypted thumbnail for image documents', async () => {
    await uploadDocument({
      petId: 'pet-1',
      name: 'photo.jpg',
      category: 'vet_report',
      uri: '/mock/photo.jpg',
      mimeType: 'image/jpeg',
    });

    expect(mockImageManipulator.manipulateAsync).toHaveBeenCalled();
    const callBody = mockApiClient.post.mock.calls[0][1] as Record<string, unknown>;
    expect(callBody.encryptedThumbnail).toBeDefined();
  });

  it('does not generate thumbnail for PDF documents', async () => {
    await uploadDocument({
      petId: 'pet-1',
      name: 'doc.pdf',
      category: 'vaccination',
      uri: '/mock/doc.pdf',
      mimeType: 'application/pdf',
    });

    const callBody = mockApiClient.post.mock.calls[0][1] as Record<string, unknown>;
    expect(callBody.encryptedThumbnail).toBeUndefined();
  });

  it('rejects unsupported MIME type', async () => {
    await expect(
      uploadDocument({
        petId: 'pet-1',
        name: 'file.exe',
        category: 'other',
        uri: '/mock/file.exe',
        mimeType: 'application/exe',
      }),
    ).rejects.toThrow('Unsupported file type');
  });

  it('rejects oversized file', async () => {
    mockFileSystem.getInfoAsync.mockResolvedValueOnce({
      exists: true,
      isDirectory: false,
      size: 21 * 1024 * 1024,
      uri: '/mock/big.pdf',
      modificationTime: 0,
    });

    await expect(
      uploadDocument({
        petId: 'pet-1',
        name: 'big.pdf',
        category: 'other',
        uri: '/mock/big.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow('File too large');
  });

  it('rejects when file does not exist', async () => {
    mockFileSystem.getInfoAsync.mockResolvedValueOnce({
      exists: false,
      isDirectory: false,
      uri: '/mock/missing.pdf',
    });

    await expect(
      uploadDocument({
        petId: 'pet-1',
        name: 'missing.pdf',
        category: 'other',
        uri: '/mock/missing.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow('File not found');
  });

  it('includes parentId for versioned uploads', async () => {
    await uploadDocument({
      petId: 'pet-1',
      name: 'test-v2.pdf',
      category: 'vaccination',
      uri: '/mock/file.pdf',
      mimeType: 'application/pdf',
      parentId: 'doc-1',
    });

    const callBody = mockApiClient.post.mock.calls[0][1] as Record<string, unknown>;
    expect(callBody.parentId).toBe('doc-1');
  });
});

describe('downloadDocument', () => {
  it('decrypts content after download', async () => {
    setupKey();

    // Encrypt some content to simulate what the server returns
    const plaintext = 'SGVsbG8gV29ybGQ='; // base64 "Hello World"
    const key = TEST_KEY;
    const iv = CryptoJS.lib.WordArray.random(12).toString(CryptoJS.enc.Hex);
    const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
      iv: CryptoJS.enc.Hex.parse(iv),
    });
    const encryptedContent = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
    const tag = CryptoJS.HmacSHA256(`${iv}:${encryptedContent}`, key).toString(CryptoJS.enc.Hex);

    mockApiClient.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          ...makeMockDoc(),
          encryptedContent,
          iv,
          tag,
          keyVersion: TEST_KEY_VERSION,
        },
      },
    });

    const result = await downloadDocument('doc-1');
    expect(result).toBe(plaintext);
  });

  it('throws on tag mismatch (tampered content)', async () => {
    setupKey();

    mockApiClient.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          ...makeMockDoc(),
          encryptedContent: 'dGFtcGVyZWQ=',
          iv: 'a'.repeat(24),
          tag: 'wrong-tag',
          keyVersion: TEST_KEY_VERSION,
        },
      },
    });

    await expect(downloadDocument('doc-1')).rejects.toThrow('tag mismatch');
  });
});

describe('saveDocumentLocally', () => {
  it('writes decrypted content to cache directory', async () => {
    setupKey();

    const plaintext = 'SGVsbG8=';
    const key = TEST_KEY;
    const iv = CryptoJS.lib.WordArray.random(12).toString(CryptoJS.enc.Hex);
    const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
      iv: CryptoJS.enc.Hex.parse(iv),
    });
    const encryptedContent = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
    const tag = CryptoJS.HmacSHA256(`${iv}:${encryptedContent}`, key).toString(CryptoJS.enc.Hex);

    mockApiClient.get.mockResolvedValue({
      data: {
        success: true,
        data: { ...makeMockDoc(), encryptedContent, iv, tag, keyVersion: TEST_KEY_VERSION },
      },
    });

    const localUri = await saveDocumentLocally('doc-1', 'test.pdf');
    expect(localUri).toBe('/mock/cache/test.pdf');
    expect(mockFileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      '/mock/cache/test.pdf',
      plaintext,
      { encoding: FileSystem.EncodingType.Base64 },
    );
  });
});

describe('listDocuments', () => {
  it('calls the correct endpoint', async () => {
    mockApiClient.get.mockResolvedValue({
      data: { success: true, data: [makeMockDoc()] },
    });

    const docs = await listDocuments('pet-1');
    expect(mockApiClient.get).toHaveBeenCalledWith(expect.stringContaining('petId=pet-1'));
    expect(docs.length).toBe(1);
  });

  it('passes category filter', async () => {
    mockApiClient.get.mockResolvedValue({ data: { success: true, data: [] } });
    await listDocuments('pet-1', { category: 'vaccination' });
    expect(mockApiClient.get).toHaveBeenCalledWith(expect.stringContaining('category=vaccination'));
  });

  it('passes includeDeleted flag', async () => {
    mockApiClient.get.mockResolvedValue({ data: { success: true, data: [] } });
    await listDocuments('pet-1', { includeDeleted: true });
    expect(mockApiClient.get).toHaveBeenCalledWith(expect.stringContaining('includeDeleted=true'));
  });
});

describe('getDocumentVersions', () => {
  it('returns version list', async () => {
    mockApiClient.get.mockResolvedValue({
      data: { success: true, data: [makeMockDoc(), makeMockDoc({ version: 2 })] },
    });

    const versions = await getDocumentVersions('doc-1');
    expect(versions.length).toBe(2);
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/documents/doc-1/versions');
  });
});

describe('deleteDocument', () => {
  it('calls delete endpoint', async () => {
    mockApiClient.delete.mockResolvedValue({ data: { success: true } });
    await deleteDocument('doc-1');
    expect(mockApiClient.delete).toHaveBeenCalledWith('/api/documents/doc-1');
  });
});

describe('restoreDocument', () => {
  it('calls restore endpoint', async () => {
    mockApiClient.post.mockResolvedValue({
      data: { success: true, data: makeMockDoc() },
    });
    const doc = await restoreDocument('doc-1');
    expect(mockApiClient.post).toHaveBeenCalledWith('/api/documents/doc-1/restore');
    expect(doc.id).toBe('doc-1');
  });
});

describe('getQuota', () => {
  it('returns quota info', async () => {
    mockApiClient.get.mockResolvedValue({
      data: {
        success: true,
        data: { used: 1024, limit: 52428800, remaining: 52427776 },
      },
    });

    const quota = await getQuota('owner-1');
    expect(quota.used).toBe(1024);
    expect(quota.limit).toBe(52428800);
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/documents/quota/owner-1');
  });
});

describe('pickDocument', () => {
  it('returns null when user cancels', async () => {
    mockDocumentPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: true,
      assets: [],
    });
    const result = await pickDocument();
    expect(result).toBeNull();
  });

  it('returns file info when user picks a file', async () => {
    mockDocumentPicker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: '/mock/file.pdf',
          name: 'document.pdf',
          mimeType: 'application/pdf',
          size: 2048,
        },
      ],
    });

    const result = await pickDocument();
    expect(result).not.toBeNull();
    expect(result?.name).toBe('document.pdf');
    expect(result?.mimeType).toBe('application/pdf');
    expect(result?.size).toBe(2048);
  });
});

describe('captureDocumentPhoto', () => {
  it('returns null when user cancels', async () => {
    mockImagePicker.launchCameraAsync.mockResolvedValueOnce({
      canceled: true,
      assets: [],
    });
    const result = await captureDocumentPhoto();
    expect(result).toBeNull();
  });

  it('throws when camera permission is denied', async () => {
    mockImagePicker.requestCameraPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      status: 'denied',
      expires: 'never',
      canAskAgain: false,
    });

    await expect(captureDocumentPhoto()).rejects.toThrow('Camera permission denied');
  });

  it('returns file info after capture', async () => {
    mockImagePicker.launchCameraAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: '/mock/photo.jpg', width: 1920, height: 1080 }],
    });

    const result = await captureDocumentPhoto();
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe('image/jpeg');
  });
});

describe('encryption round-trip', () => {
  it('encrypt then decrypt returns original content', async () => {
    setupKey();

    const originalContent = 'SGVsbG8gV29ybGQgZnJvbSBQZXRDaGFpbg==';
    mockFileSystem.readAsStringAsync.mockResolvedValueOnce(originalContent);

    let capturedBody: Record<string, unknown> = {};
    mockApiClient.post.mockImplementation(async (_url, body) => {
      capturedBody = body as Record<string, unknown>;
      return { data: { success: true, data: makeMockDoc() } };
    });

    await uploadDocument({
      petId: 'pet-1',
      name: 'test.pdf',
      category: 'vaccination',
      uri: '/mock/file.pdf',
      mimeType: 'application/pdf',
    });

    // Now simulate download with the captured encrypted data
    mockApiClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          ...makeMockDoc(),
          encryptedContent: capturedBody.encryptedContent,
          iv: capturedBody.iv,
          tag: capturedBody.tag,
          keyVersion: capturedBody.keyVersion,
        },
      },
    });

    const decrypted = await downloadDocument('doc-1');
    expect(decrypted).toBe(originalContent);
  });
});
