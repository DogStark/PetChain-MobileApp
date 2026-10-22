/**
 * Tests for src/services/appLockService.ts
 *
 * Verifies: monotonic timeout calculation, clock rollback handling,
 * process death/reboot safety, and persisted lifecycle timestamps.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getMonotonicElapsed,
  persistAppBackground,
  persistAppForeground,
  getElapsedSinceBackground,
  clearPersistedTimestamps,
} from '../services/appLockService';

jest.mock('@react-native-async-storage/async-storage');
const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('appLockService - Monotonic timeout and reboot safety', () => {
  describe('getMonotonicElapsed', () => {
    it('returns elapsed time using performance.now() when available', () => {
      const before = performance.now();
      jest.advanceTimersByTime(1000);
      const elapsed = getMonotonicElapsed(before);
      expect(elapsed).toBeGreaterThanOrEqual(1000);
    });

    it('falls back to Date.now() when performance.now() is unavailable', () => {
      const savedPerformance = global.performance;
      // @ts-ignore
      global.performance = undefined;

      const beforeMs = Date.now();
      jest.advanceTimersByTime(1000);
      const elapsed = getMonotonicElapsed(beforeMs);
      expect(elapsed).toBeGreaterThanOrEqual(1000);

      global.performance = savedPerformance;
    });
  });

  describe('persistAppBackground', () => {
    it('stores the current timestamp to AsyncStorage', async () => {
      mockAsyncStorage.setItem.mockResolvedValue(null);
      jest.setSystemTime(new Date('2025-01-01T12:00:00Z'));

      await persistAppBackground();

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining('background'),
        expect.any(String),
      );
    });

    it('handles AsyncStorage write failure gracefully', async () => {
      mockAsyncStorage.setItem.mockRejectedValue(new Error('Storage error'));
      await expect(persistAppBackground()).resolves.not.toThrow();
    });
  });

  describe('persistAppForeground', () => {
    it('stores the current timestamp to AsyncStorage', async () => {
      mockAsyncStorage.setItem.mockResolvedValue(null);

      await persistAppForeground();

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining('foreground'),
        expect.any(String),
      );
    });
  });

  describe('getElapsedSinceBackground', () => {
    it('returns elapsed time from persisted background timestamp', async () => {
      const backgroundTime = Date.now();
      mockAsyncStorage.getItem.mockResolvedValue(String(backgroundTime));

      jest.advanceTimersByTime(5000);

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBeGreaterThanOrEqual(5000);
    });

    it('returns 0 when no background timestamp is persisted (e.g., first launch)', async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBe(0);
    });

    it('handles clock rollback: returns 0 if background timestamp is in future', async () => {
      const futureTime = Date.now() + 10000;
      mockAsyncStorage.getItem.mockResolvedValue(String(futureTime));

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBe(0);
    });

    it('handles malformed persisted timestamp gracefully', async () => {
      mockAsyncStorage.getItem.mockResolvedValue('invalid-timestamp');

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBe(0);
    });

    it('handles AsyncStorage read failure gracefully', async () => {
      mockAsyncStorage.getItem.mockRejectedValue(new Error('Read error'));

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBe(0);
    });
  });

  describe('Process reboot and clock rollback scenarios', () => {
    it('survives app process death: elapsed time is calculated from persisted timestamp on relaunch', async () => {
      const backgroundTime = Date.now();
      mockAsyncStorage.getItem.mockResolvedValue(String(backgroundTime));

      // Simulate time passing during process death and relaunch
      jest.advanceTimersByTime(8000);

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBeGreaterThanOrEqual(8000);
    });

    it('detects clock rollback: if background timestamp is in future, treats as no elapsed time', async () => {
      const futureTime = Date.now() + 60000;
      mockAsyncStorage.getItem.mockResolvedValue(String(futureTime));

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBe(0);
    });

    it('handles large clock-forward jump safely', async () => {
      const backgroundTime = Date.now();
      mockAsyncStorage.getItem.mockResolvedValue(String(backgroundTime));

      jest.advanceTimersByTime(3600000); // 1 hour

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBeGreaterThanOrEqual(3600000);
    });
  });

  describe('clearPersistedTimestamps', () => {
    it('clears both background and foreground timestamps', async () => {
      mockAsyncStorage.removeItem.mockResolvedValue(null);

      await clearPersistedTimestamps();

      expect(mockAsyncStorage.removeItem).toHaveBeenCalledTimes(2);
    });
  });
});
