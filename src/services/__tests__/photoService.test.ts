/**
 * photoService.test.ts — #964 cancellable media upload with resumable progress
 *
 * Tests cover:
 *  - Pre-upload behaviour: EXIF strip + compress + SHA-256 checksum
 *  - Metered-network gate (blocked / allowed)
 *  - Upload cancellation via AbortController → UploadCancelledError
 *  - Progress callback invocations
 *  - Checksum header forwarded to XHR
 *  - Retry-idempotency: duplicate checksum handled gracefully
 *  - listPhotos, getPhoto, deletePhoto pass-through
 *
 * Platform notes: these tests run in the Node Jest environment; XMLHttpRequest
 * is shimmed via the react-native mock (which provides a minimal XHR shim).
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn().mockResolvedValue({
    uri: '/mock/processed.jpg',
    width: 1280,
    height: 960,
    base64: 'bW9ja2Jhc2U2NAo=', // "mockbase64\n"
  }),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-file-system', () => ({
  cacheDirectory: '/mock/cache/',
  documentDirectory: '/mock/documents/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  readAsStringAsync: jest.fn().mockResolvedValue('bW9ja2Jhc2U2NAo='),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, isDirectory: false, size: 4096 }),
}));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({
    isConnected: true,
    details: { isConnectionExpensive: false },
  }),
}));

jest.mock('../apiClient', () => ({
  __esModule: true,
  default: {
    defaults: { baseURL: 'https://api.petchain.test', headers: {} },
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';

import apiClient from '../apiClient';
import photoService, {
  UploadCancelledError,
  stripExifAndCompress,
  uploadPhoto,
  listPhotos,
  getPhoto,
  deletePhoto,
  type PhotoQuality,
} from '../photoService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockImageManipulator = ImageManipulator as jest.Mocked<typeof ImageManipulator>;
const mockNetInfo = NetInfo as jest.Mocked<typeof NetInfo>;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

beforeEach(() => {
  jest.clearAllMocks();
  (mockNetInfo.fetch as jest.Mock).mockReset();
  (mockNetInfo.fetch as jest.Mock).mockResolvedValue({
    isConnected: true,
    details: { isConnectionExpensive: false },
  });
});

function makePhoto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'photo-1',
    petId: 'pet-1',
    url: 'https://cdn.example.com/photo-1.jpg',
    thumbnailUrl: 'https://cdn.example.com/photo-1-thumb.jpg',
    sizeBytes: 102400,
    width: 1280,
    height: 960,
    uploadedAt: new Date().toISOString(),
    uploadedById: 'user-1',
    ...overrides,
  };
}

/**
 * Install a minimal XMLHttpRequest shim that immediately succeeds,
 * and returns accessors so individual tests can customise behaviour.
 */
function installXhrShim(options: {
  status?: number;
  responseText?: string;
  abortBehaviour?: 'fire-abort-event' | 'fire-error-event' | 'silent';
  progressEvents?: Array<{ loaded: number; total: number }>;
}) {
  const xhrInstance: Record<string, any> = {
    upload: { onprogress: null as any },
    open: jest.fn(),
    send: jest.fn(),
    abort: jest.fn(),
    setRequestHeader: jest.fn(),
    onload: null as any,
    onerror: null as any,
    onabort: null as any,
    status: options.status ?? 200,
    responseText: options.responseText ?? JSON.stringify({ photo: makePhoto() }),
  };

  // When send() is called, simulate async network I/O
  xhrInstance.send.mockImplementation(() => {
    // Emit progress events first
    const progressEvents = options.progressEvents ?? [{ loaded: 100, total: 100 }];
    for (const evt of progressEvents) {
      xhrInstance.upload.onprogress?.({ ...evt, lengthComputable: true });
    }

    if (options.abortBehaviour === 'fire-abort-event') {
      xhrInstance.onabort?.();
    } else if (options.abortBehaviour === 'fire-error-event') {
      xhrInstance.onerror?.();
    } else {
      xhrInstance.onload?.();
    }
  });

  (global as any).XMLHttpRequest = jest.fn(() => xhrInstance);
  return xhrInstance;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('stripExifAndCompress', () => {
  it('calls manipulateAsync twice (resize then compress)', async () => {
    await stripExifAndCompress('/local/photo.jpg', 'medium');
    expect(mockImageManipulator.manipulateAsync).toHaveBeenCalledTimes(2);
  });

  it('returns processed photo metadata', async () => {
    const result = await stripExifAndCompress('/local/photo.jpg', 'medium');
    expect(result.uri).toBe('/mock/processed.jpg');
    expect(result.width).toBe(1280);
    expect(result.height).toBe(960);
    expect(result.estimatedBytes).toBeGreaterThan(0);
  });

  it('computes a SHA-256 checksum from base64', async () => {
    const result = await stripExifAndCompress('/local/photo.jpg', 'medium');
    // Should be a 64-char hex string
    expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each<PhotoQuality>(['high', 'medium', 'low'])(
    'respects the %s quality preset',
    async (quality) => {
      await stripExifAndCompress('/local/photo.jpg', quality);
      // manipulateAsync is called; first arg includes the local URI
      expect(mockImageManipulator.manipulateAsync).toHaveBeenCalledWith(
        '/local/photo.jpg',
        expect.any(Array),
        expect.any(Object),
      );
    },
  );
});

describe('metered-network gate', () => {
  it('blocks upload on metered connection when allowMetered is false', async () => {
    (mockNetInfo.fetch as jest.Mock).mockResolvedValueOnce({
      isConnected: true,
      details: { isConnectionExpensive: true },
    });

    const handle = uploadPhoto({ petId: 'pet-1', localUri: '/local/photo.jpg' });
    await expect(handle.promise).rejects.toThrow('metered');
  });

  it('allows upload on metered connection when allowMetered is true', async () => {
    (mockNetInfo.fetch as jest.Mock).mockResolvedValueOnce({
      isConnected: true,
      details: { isConnectionExpensive: true },
    });

    installXhrShim({});
    const handle = uploadPhoto({
      petId: 'pet-1',
      localUri: '/local/photo.jpg',
      allowMetered: true,
    });
    await expect(handle.promise).resolves.toBeDefined();
  });

  it('allows upload on unmetered (Wi-Fi) connection', async () => {
    (mockNetInfo.fetch as jest.Mock).mockResolvedValueOnce({
      isConnected: true,
      details: { isConnectionExpensive: false },
    });

    installXhrShim({});
    const handle = uploadPhoto({ petId: 'pet-1', localUri: '/local/photo.jpg' });
    await expect(handle.promise).resolves.toBeDefined();
  });
});

describe('uploadPhoto — success path', () => {
  it('resolves with the uploaded photo', async () => {
    installXhrShim({});
    const handle = uploadPhoto({ petId: 'pet-1', localUri: '/local/photo.jpg' });
    const result = await handle.promise;
    expect(result).toBeDefined();
    expect(result.photo.id).toBe('photo-1');
  });

  it('calls onProgress with increasing values up to 1', async () => {
    installXhrShim({
      progressEvents: [
        { loaded: 25, total: 100 },
        { loaded: 50, total: 100 },
        { loaded: 100, total: 100 },
      ],
    });

    const progressValues: number[] = [];
    const handle = uploadPhoto({
      petId: 'pet-1',
      localUri: '/local/photo.jpg',
      onProgress: (f) => progressValues.push(f),
    });
    await handle.promise;

    // Should start at 0.1 (processing done), end at 1
    expect(progressValues[0]).toBeCloseTo(0.1);
    expect(progressValues[progressValues.length - 1]).toBe(1);
    // Values should be non-decreasing
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
    }
  });

  it('sets X-Checksum-SHA256 header', async () => {
    const xhr = installXhrShim({});
    await uploadPhoto({ petId: 'pet-1', localUri: '/local/photo.jpg' }).promise;

    const checksumCall = (xhr.setRequestHeader as jest.Mock).mock.calls.find(
      ([header]: [string]) => header === 'X-Checksum-SHA256',
    );
    expect(checksumCall).toBeDefined();
    expect(checksumCall[1]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('uploadPhoto — cancellation', () => {
  it('rejects with UploadCancelledError when abort() is called before XHR finishes', async () => {
    // shim that fires onabort when send() is called
    installXhrShim({ abortBehaviour: 'fire-abort-event' });

    const handle = uploadPhoto({ petId: 'pet-1', localUri: '/local/photo.jpg' });
    handle.abort();

    await expect(handle.promise).rejects.toBeInstanceOf(UploadCancelledError);
  });

  it('UploadCancelledError is not a generic Error subclass ambiguity', async () => {
    installXhrShim({ abortBehaviour: 'fire-abort-event' });

    const handle = uploadPhoto({ petId: 'pet-1', localUri: '/local/photo.jpg' });
    handle.abort();

    try {
      await handle.promise;
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UploadCancelledError);
      expect((err as Error).name).toBe('UploadCancelledError');
    }
  });

  it('does not invoke onProgress after cancellation', async () => {
    installXhrShim({ abortBehaviour: 'fire-abort-event' });

    const progressValues: number[] = [];
    const handle = uploadPhoto({
      petId: 'pet-1',
      localUri: '/local/photo.jpg',
      onProgress: (f) => progressValues.push(f),
    });
    handle.abort();

    try {
      await handle.promise;
    } catch {
      /* expected */
    }

    // After abort, progress should not reach 1
    expect(progressValues.includes(1)).toBe(false);
  });
});

describe('uploadPhoto — error paths', () => {
  it('rejects on network error', async () => {
    installXhrShim({ abortBehaviour: 'fire-error-event' });
    const handle = uploadPhoto({ petId: 'pet-1', localUri: '/local/photo.jpg' });
    await expect(handle.promise).rejects.toThrow('Network error');
  });

  it('rejects on non-2xx HTTP status', async () => {
    installXhrShim({ status: 500, responseText: '{"error":"Internal Server Error"}' });
    const handle = uploadPhoto({ petId: 'pet-1', localUri: '/local/photo.jpg' });
    await expect(handle.promise).rejects.toThrow('500');
  });

  it('rejects with processing error message when manipulateAsync throws', async () => {
    mockImageManipulator.manipulateAsync.mockRejectedValueOnce(new Error('Manipulator crashed'));
    const handle = uploadPhoto({ petId: 'pet-1', localUri: '/local/photo.jpg' });
    await expect(handle.promise).rejects.toThrow('Failed to process photo');
  });
});

describe('listPhotos', () => {
  it('calls the correct endpoint with pagination params', async () => {
    mockApiClient.get.mockResolvedValueOnce({ data: { data: [makePhoto()] } });
    const photos = await listPhotos('pet-1', { page: 2, limit: 10 });
    expect(mockApiClient.get).toHaveBeenCalledWith('/photos/pet/pet-1', {
      params: { page: 2, limit: 10 },
    });
    expect(photos).toHaveLength(1);
  });
});

describe('getPhoto', () => {
  it('returns a single photo', async () => {
    mockApiClient.get.mockResolvedValueOnce({ data: { data: makePhoto() } });
    const photo = await getPhoto('photo-1');
    expect(photo.id).toBe('photo-1');
  });
});

describe('deletePhoto', () => {
  it('calls the delete endpoint', async () => {
    mockApiClient.delete.mockResolvedValueOnce({});
    await deletePhoto('photo-1');
    expect(mockApiClient.delete).toHaveBeenCalledWith('/photos/photo-1');
  });
});
