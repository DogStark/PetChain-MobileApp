/**
 * Photo metadata / orientation tests  (Issue #963)
 *
 * The re-encode already removed EXIF, but the surrounding pipeline had gaps:
 * it upscaled small images to the preset's maximum, encoded twice, never
 * checked what came back, and enforced no size or format limit.
 */

jest.mock('../../utils/errorLogger', () => ({ logError: jest.fn() }));

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  __esModule: true,
  manipulateAsync: (...args: unknown[]) => mockManipulate(...args),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

/** Source dimensions the `Image.getSize` mock reports. */
const mockSourceSize = { width: 4000, height: 3000, fail: false };
jest.mock('react-native', () => ({
  Image: {
    getSize: (
      _uri: string,
      success: (w: number, h: number) => void,
      failure: (e: unknown) => void,
    ) => {
      if (mockSourceSize.fail) failure(new Error('unreadable'));
      else success(mockSourceSize.width, mockSourceSize.height);
    },
  },
}));

jest.mock('../apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn(), delete: jest.fn() },
}));

import {
  PHOTO_LIMITS,
  PhotoValidationError,
  stripExifAndCompress,
  verifyProcessedOutput,
} from '../photoService';

/** Make the manipulator echo back a plausibly-resized result. */
function respondWithResize() {
  mockManipulate.mockImplementation(
    async (_uri: string, actions: Array<Record<string, { width?: number; height?: number }>>) => {
      const resize = actions.find((a) => a.resize)?.resize;
      const ratio = mockSourceSize.width / mockSourceSize.height;
      if (resize?.width) {
        return {
          uri: 'file:///out.jpg',
          width: resize.width,
          height: Math.round(resize.width / ratio),
        };
      }
      if (resize?.height) {
        return {
          uri: 'file:///out.jpg',
          width: Math.round(resize.height * ratio),
          height: resize.height,
        };
      }
      return { uri: 'file:///out.jpg', width: mockSourceSize.width, height: mockSourceSize.height };
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSourceSize.width = 4000;
  mockSourceSize.height = 3000;
  mockSourceSize.fail = false;
  respondWithResize();
});

// ─── Re-encode ───────────────────────────────────────────────────────────────

describe('metadata removal', () => {
  it('always re-encodes as JPEG, which is what drops EXIF', async () => {
    await stripExifAndCompress('file:///photo.jpg', 'medium');

    const [, , options] = mockManipulate.mock.calls[0];
    expect(options.format).toBe('jpeg');
  });

  it('encodes exactly once', async () => {
    // The previous implementation ran two passes (quality 1.0, then compress),
    // compounding JPEG artefacts for no benefit.
    await stripExifAndCompress('file:///photo.jpg', 'high');

    expect(mockManipulate).toHaveBeenCalledTimes(1);
  });

  it('applies the compression level for the chosen preset', async () => {
    await stripExifAndCompress('file:///photo.jpg', 'low');
    expect(mockManipulate.mock.calls[0][2].compress).toBe(0.5);

    mockManipulate.mockClear();
    await stripExifAndCompress('file:///photo.jpg', 'high');
    expect(mockManipulate.mock.calls[0][2].compress).toBe(0.9);
  });
});

// ─── Downscale only ──────────────────────────────────────────────────────────

describe('resizing', () => {
  it('does not upscale an image smaller than the preset maximum', async () => {
    mockSourceSize.width = 400;
    mockSourceSize.height = 300;

    const result = await stripExifAndCompress('file:///small.jpg', 'medium');

    // No resize action at all — the source is already within bounds.
    expect(mockManipulate.mock.calls[0][1]).toEqual([]);
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it('downscales a landscape image by its width', async () => {
    mockSourceSize.width = 4000;
    mockSourceSize.height = 3000;

    await stripExifAndCompress('file:///big.jpg', 'medium');

    expect(mockManipulate.mock.calls[0][1]).toEqual([{ resize: { width: 1280 } }]);
  });

  it('downscales a portrait image by its height, not its width', async () => {
    // Constraining width would leave a tall image far above the limit.
    mockSourceSize.width = 3000;
    mockSourceSize.height = 4000;

    await stripExifAndCompress('file:///portrait.jpg', 'medium');

    expect(mockManipulate.mock.calls[0][1]).toEqual([{ resize: { height: 1280 } }]);
  });

  it('keeps the longest edge within the preset limit for every preset', async () => {
    mockSourceSize.width = 6000;
    mockSourceSize.height = 4000;

    for (const [preset, limit] of Object.entries(PHOTO_LIMITS.maxOutputDimension)) {
      mockManipulate.mockClear();
      const result = await stripExifAndCompress(
        'file:///big.jpg',
        preset as 'high' | 'medium' | 'low',
      );
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(limit);
    }
  });
});

// ─── Orientation ─────────────────────────────────────────────────────────────

describe('orientation', () => {
  it('preserves the aspect ratio of a portrait photo', async () => {
    mockSourceSize.width = 3000;
    mockSourceSize.height = 4000;

    const result = await stripExifAndCompress('file:///portrait.jpg', 'medium');

    expect(result.height).toBeGreaterThan(result.width);
    expect(result.width / result.height).toBeCloseTo(3000 / 4000, 2);
  });

  it('rejects output whose aspect ratio was flipped', () => {
    // A decoder that ignored the EXIF orientation tag produces exactly this:
    // portrait source, landscape output.
    expect(() =>
      verifyProcessedOutput(
        { uri: 'file:///out.jpg', width: 1280, height: 960 },
        { width: 3000, height: 4000 },
        1280,
      ),
    ).toThrow(/orientation may have been lost/i);
  });
});

// ─── Limits ──────────────────────────────────────────────────────────────────

describe('limits', () => {
  it('rejects a file larger than the documented maximum', async () => {
    await expect(
      stripExifAndCompress('file:///huge.jpg', 'medium', PHOTO_LIMITS.maxInputBytes + 1),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });

    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the maximum', async () => {
    await expect(
      stripExifAndCompress('file:///edge.jpg', 'medium', PHOTO_LIMITS.maxInputBytes),
    ).resolves.toBeDefined();
  });

  it('rejects an unsupported container', async () => {
    await expect(stripExifAndCompress('file:///clip.mp4', 'medium')).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
  });

  it('accepts every documented input extension', async () => {
    for (const ext of PHOTO_LIMITS.allowedInputExtensions) {
      await expect(stripExifAndCompress(`file:///photo.${ext}`, 'low')).resolves.toBeDefined();
    }
  });

  it('allows an extensionless URI, as Android content:// URIs often are', async () => {
    await expect(
      stripExifAndCompress('content://media/external/images/media/42', 'medium'),
    ).resolves.toBeDefined();
  });

  it('ignores query strings when reading the extension', async () => {
    await expect(
      stripExifAndCompress('file:///photo.jpg?width=100', 'medium'),
    ).resolves.toBeDefined();
  });
});

// ─── Output verification ─────────────────────────────────────────────────────

describe('output verification', () => {
  it('rejects an empty URI', () => {
    expect(() =>
      verifyProcessedOutput(
        { uri: '', width: 100, height: 100 },
        { width: 100, height: 100 },
        1280,
      ),
    ).toThrow(PhotoValidationError);
  });

  it('rejects zero dimensions', () => {
    expect(() =>
      verifyProcessedOutput(
        { uri: 'file:///out.jpg', width: 0, height: 100 },
        { width: 100, height: 100 },
        1280,
      ),
    ).toThrow(/invalid dimensions/i);
  });

  it('rejects output that exceeds the limit', () => {
    expect(() =>
      verifyProcessedOutput(
        { uri: 'file:///out.jpg', width: 4000, height: 3000 },
        { width: 4000, height: 3000 },
        1280,
      ),
    ).toThrow(/exceeds the 1280px limit/i);
  });

  it('surfaces a failed resize instead of uploading it', async () => {
    // Manipulator claims success but hands back the untouched original.
    mockManipulate.mockResolvedValue({ uri: 'file:///out.jpg', width: 4000, height: 3000 });

    await expect(stripExifAndCompress('file:///big.jpg', 'medium')).rejects.toMatchObject({
      code: 'VERIFICATION_FAILED',
    });
  });

  it('reports an unreadable source rather than guessing its size', async () => {
    mockSourceSize.fail = true;

    await expect(stripExifAndCompress('file:///corrupt.jpg', 'medium')).rejects.toMatchObject({
      code: 'DECODE_FAILED',
    });
  });
});
