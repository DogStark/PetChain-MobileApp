import * as Application from 'expo-application';

import apiClient from '../../services/apiClient';
import { checkAppVersion, clearVersionCheckCache } from '../../services/versionCheckService';

jest.mock('../../services/apiClient', () => ({
  get: jest.fn(),
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.2.0',
  applicationVersion: '1.2.0',
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('../../utils/errorLogger', () => ({ logError: jest.fn() }));

const mockAsyncStorage = {
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

const mockResponse = {
  minimumVersion: '1.0.0',
  recommendedVersion: '1.0.0',
  iosStoreUrl: 'https://apps.apple.com/app/petchain/id000000000',
  androidStoreUrl: 'https://play.google.com/store/apps/details?id=app.petchain.mobile',
  message: 'Update available',
};

describe('versionCheckService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
  });

  describe('checkAppVersion', () => {
    it('returns up-to-date when current version meets minimum and recommended', async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({ data: mockResponse });
      const result = await checkAppVersion();
      expect(result.type).toBe('up-to-date');
    });

    it('returns critical when current version is below minimum', async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({
        data: { ...mockResponse, minimumVersion: '2.0.0', recommendedVersion: '2.0.0' },
      });
      const result = await checkAppVersion();
      expect(result.type).toBe('critical');
      if (result.type === 'critical') {
        expect(result.storeUrl).toBe(mockResponse.iosStoreUrl);
      }
    });

    it('returns recommended when current version is below recommended but above minimum', async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({
        data: { ...mockResponse, minimumVersion: '1.0.0', recommendedVersion: '1.5.0' },
      });
      const result = await checkAppVersion();
      expect(result.type).toBe('recommended');
    });

    it('returns cached result within TTL without calling API', async () => {
      const cachedResult = { type: 'up-to-date' };
      mockAsyncStorage.getItem.mockResolvedValue(
        JSON.stringify({ result: cachedResult, cachedAt: Date.now() }),
      );
      const result = await checkAppVersion();
      expect(result.type).toBe('up-to-date');
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('fetches fresh result when cache is expired', async () => {
      const expiredCache = {
        result: { type: 'up-to-date' },
        cachedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
      };
      mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(expiredCache));
      (apiClient.get as jest.Mock).mockResolvedValue({ data: mockResponse });

      const result = await checkAppVersion();
      expect(apiClient.get).toHaveBeenCalledWith('/app/version-check');
      expect(result.type).toBe('up-to-date');
    });

    it('returns error when API call fails', async () => {
      (apiClient.get as jest.Mock).mockRejectedValue(new Error('Network error'));
      const result = await checkAppVersion();
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.message).toBe('Network error');
      }
    });

    it('caches the result after a successful API call', async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({ data: mockResponse });
      await checkAppVersion();
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        '@version_check_cache',
        expect.stringContaining('"type":"up-to-date"'),
      );
    });
  });

  describe('clearVersionCheckCache', () => {
    it('removes the cache key', async () => {
      await clearVersionCheckCache();
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('@version_check_cache');
    });
  });
});
