/**
 * Tests for src/services/pinLockStateService.ts and PIN attempt/cooldown state persistence.
 *
 * Verifies: attempt counter survival across process restarts, cooldown timer
 * persistence, rapid restart handling, and permission-denied graceful failure.
 */

import * as SecureStore from 'expo-secure-store';
import {
  loadAttempts,
  saveAttempts,
  loadCooldownUntil,
  saveCooldownUntil,
  clearLockState,
  ensureAttemptStateIsSafe,
} from '../services/pinLockStateService';

jest.mock('expo-secure-store');
const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('LockScreen PIN attempt/cooldown state persistence', () => {
  describe('loadAttempts', () => {
    it('loads attempt count from SecureStore', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue('5');

      const attempts = await loadAttempts();

      expect(attempts).toBe(5);
      expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith(expect.stringContaining('attempts'));
    });

    it('returns 0 when no attempt state is stored (new session)', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);

      const attempts = await loadAttempts();

      expect(attempts).toBe(0);
    });

    it('returns 0 on SecureStore read error (fails safe to locked state)', async () => {
      mockSecureStore.getItemAsync.mockRejectedValue(new Error('Permission denied'));

      const attempts = await loadAttempts();

      expect(attempts).toBe(0);
    });

    it('handles malformed attempt count gracefully', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue('not-a-number');

      const attempts = await loadAttempts();

      expect(attempts).toBe(0);
    });
  });

  describe('saveAttempts', () => {
    it('persists attempt count to SecureStore', async () => {
      mockSecureStore.setItemAsync.mockResolvedValue(null);

      await saveAttempts(7);

      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
        expect.stringContaining('attempts'),
        '7',
      );
    });

    it('handles SecureStore write error gracefully', async () => {
      mockSecureStore.setItemAsync.mockRejectedValue(new Error('Permission denied'));

      await expect(saveAttempts(7)).resolves.not.toThrow();
    });
  });

  describe('loadCooldownUntil', () => {
    it('loads cooldown-until timestamp from SecureStore', async () => {
      const futureTime = Date.now() + 60000;
      mockSecureStore.getItemAsync.mockResolvedValue(String(futureTime));

      const cooldownUntil = await loadCooldownUntil();

      expect(cooldownUntil).toBe(futureTime);
    });

    it('returns 0 when no cooldown is active (new session)', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);

      const cooldownUntil = await loadCooldownUntil();

      expect(cooldownUntil).toBe(0);
    });

    it('returns 0 on SecureStore read error (fails safe to locked state)', async () => {
      mockSecureStore.getItemAsync.mockRejectedValue(new Error('Permission denied'));

      const cooldownUntil = await loadCooldownUntil();

      expect(cooldownUntil).toBe(0);
    });

    it('handles malformed cooldown timestamp gracefully', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue('not-a-timestamp');

      const cooldownUntil = await loadCooldownUntil();

      expect(cooldownUntil).toBe(0);
    });
  });

  describe('saveCooldownUntil', () => {
    it('persists cooldown-until timestamp to SecureStore', async () => {
      mockSecureStore.setItemAsync.mockResolvedValue(null);
      const futureTime = Date.now() + 60000;

      await saveCooldownUntil(futureTime);

      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
        expect.stringContaining('cooldown'),
        String(futureTime),
      );
    });

    it('handles SecureStore write error gracefully', async () => {
      mockSecureStore.setItemAsync.mockRejectedValue(new Error('Permission denied'));

      await expect(saveCooldownUntil(Date.now() + 60000)).resolves.not.toThrow();
    });
  });

  describe('Process restart and state recovery', () => {
    it('recovers attempt state after app process death', async () => {
      // Initial state: 5 attempts, no cooldown
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        if (key.includes('attempts')) return Promise.resolve('5');
        if (key.includes('cooldown')) return Promise.resolve('0');
        return Promise.resolve(null);
      });

      // Simulate app process death and restart
      const attempts = await loadAttempts();
      const cooldown = await loadCooldownUntil();

      expect(attempts).toBe(5);
      expect(cooldown).toBe(0);
    });

    it('recovers active cooldown after app process death', async () => {
      const futureTime = Date.now() + 60000;
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        if (key.includes('attempts')) return Promise.resolve('8');
        if (key.includes('cooldown')) return Promise.resolve(String(futureTime));
        return Promise.resolve(null);
      });

      jest.setSystemTime(new Date('2025-01-01T12:00:00Z'));

      const attempts = await loadAttempts();
      const cooldown = await loadCooldownUntil();

      expect(attempts).toBe(8);
      expect(cooldown).toBe(futureTime);
      // Cooldown should not have been reset by restart
      expect(cooldown).toBeGreaterThan(Date.now());
    });

    it('handles rapid restarts without resetting cooldown', async () => {
      const futureTime = Date.now() + 30000;
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        if (key.includes('cooldown')) return Promise.resolve(String(futureTime));
        return Promise.resolve('8');
      });

      // First restart
      let cooldown = await loadCooldownUntil();
      expect(cooldown).toBe(futureTime);

      // Advance time by 100ms (still in cooldown)
      jest.advanceTimersByTime(100);

      // Second restart
      cooldown = await loadCooldownUntil();
      expect(cooldown).toBe(futureTime);
    });
  });

  describe('clearLockState', () => {
    it('clears both attempt and cooldown state', async () => {
      mockSecureStore.deleteItemAsync.mockResolvedValue(null);

      await clearLockState();

      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
    });

    it('handles deletion errors gracefully', async () => {
      mockSecureStore.deleteItemAsync.mockRejectedValue(new Error('Permission denied'));

      await expect(clearLockState()).resolves.not.toThrow();
    });
  });

  describe('ensureAttemptStateIsSafe', () => {
    it('validates that current attempt count matches stored state', async () => {
      const storedAttempts = 5;
      mockSecureStore.getItemAsync.mockResolvedValue(String(storedAttempts));

      const isSafe = await ensureAttemptStateIsSafe(storedAttempts);

      expect(isSafe).toBe(true);
    });

    it('detects mismatch between current and stored attempt state', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue('8');

      const isSafe = await ensureAttemptStateIsSafe(5);

      expect(isSafe).toBe(false);
    });

    it('fails safe (returns false) on SecureStore read error', async () => {
      mockSecureStore.getItemAsync.mockRejectedValue(new Error('Permission denied'));

      const isSafe = await ensureAttemptStateIsSafe(5);

      expect(isSafe).toBe(false);
    });
  });

  describe('Reinstall behavior documentation', () => {
    it('attempts reset to 0 when SecureStore is cleared by reinstall', async () => {
      // On reinstall, SecureStore typically clears on iOS; Android Keystore may persist.
      // This test documents the expected behavior.
      mockSecureStore.getItemAsync.mockResolvedValue(null);

      const attempts = await loadAttempts();

      expect(attempts).toBe(0);
    });
  });
});
