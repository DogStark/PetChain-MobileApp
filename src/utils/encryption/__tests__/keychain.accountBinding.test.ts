import * as SecureStore from 'expo-secure-store';
import * as Keychain from 'react-native-keychain';
import {
  storeSecureTokens,
  getSecureTokens,
  getSecureToken,
  clearSecureTokens,
} from '../keychain';

// Mock modules
jest.mock('expo-secure-store');
jest.mock('react-native-keychain');

describe('Keychain Account Binding (#905)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Cross-account credential isolation', () => {
    it('should reproduce vulnerability: tokens stored under shared key leak across accounts', async () => {
      // Simulate account A login
      const accountAId = 'user-001';
      const accountAToken = 'token-a-123456';
      const accountARefresh = 'refresh-a-123456';

      // Store tokens for account A
      await storeSecureTokens(
        { token: accountAToken, refreshToken: accountARefresh },
        accountAId,
      );

      // Retrieve account A tokens
      let retrievedTokens = await getSecureTokens(accountAId);
      expect(retrievedTokens?.token).toBe(accountAToken);
      expect(retrievedTokens?.refreshToken).toBe(accountARefresh);

      // Simulate account B login (should clear account A's tokens)
      const accountBId = 'user-002';
      const accountBToken = 'token-b-789012';
      const accountBRefresh = 'refresh-b-789012';

      // Store tokens for account B
      await storeSecureTokens(
        { token: accountBToken, refreshToken: accountBRefresh },
        accountBId,
      );

      // CRITICAL TEST: Account A's tokens should NOT be accessible via account B's key
      const accountBTokens = await getSecureTokens(accountBId);
      expect(accountBTokens?.token).toBe(accountBToken);
      expect(accountBTokens?.refreshToken).toBe(accountBRefresh);

      // Account A's tokens should still be under account A's namespaced key
      const accountATokensStillValid = await getSecureTokens(accountAId);
      expect(accountATokensStillValid?.token).toBe(accountAToken);
      expect(accountATokensStillValid?.refreshToken).toBe(accountARefresh);

      // Account B tokens should NOT match account A tokens
      expect(accountBTokens?.token).not.toBe(accountAToken);
    });

    it('should namespace secure-store keys by stable account ID (not email/name)', async () => {
      const userId = 'user-uuid-12345';
      const token = 'test-token-abc123';

      // Mock SecureStore.setItemAsync to capture the key
      let capturedKey = '';
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(
        (key) => {
          capturedKey = key;
          return Promise.resolve();
        },
      );

      // Mock encryption key retrieval
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: 'encryption-key-12345',
      });

      await storeSecureTokens({ token }, userId);

      // Verify key includes account ID, not mutable fields
      expect(capturedKey).toContain(userId);
      expect(capturedKey).not.toMatch(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i); // no email
    });

    it('should atomically clear obsolete sessions on account switch', async () => {
      const accountAId = 'user-001';
      const accountBId = 'user-002';

      // Mock storage operations
      const clearedKeys: string[] = [];
      (SecureStore.deleteItemAsync as jest.Mock).mockImplementation((key) => {
        clearedKeys.push(key);
        return Promise.resolve();
      });

      // Simulate switching from account A to B
      await clearSecureTokens(accountAId);

      // Verify account A's namespaced key was cleared
      expect(clearedKeys.some((k) => k.includes(accountAId))).toBe(true);
      // Ensure account B's key was NOT cleared
      expect(clearedKeys.some((k) => k.includes(accountBId))).toBe(false);
    });
  });

  describe('Restored device state handling', () => {
    it('should handle restored device state by clearing tokens from previous account', async () => {
      const previousAccountId = 'user-old-001';
      const currentAccountId = 'user-new-002';

      // Mock that previous account data still exists
      let storedTokens: Record<string, any> = {
        [`com.petchain.auth.tokens.${previousAccountId}`]: 'old-encrypted-token',
      };

      (SecureStore.getItemAsync as jest.Mock).mockImplementation((key) => {
        return Promise.resolve(storedTokens[key] || null);
      });

      (SecureStore.deleteItemAsync as jest.Mock).mockImplementation((key) => {
        delete storedTokens[key];
        return Promise.resolve();
      });

      // Restore device, new login clears old account
      await clearSecureTokens(previousAccountId);

      // Verify old account's tokens were cleared
      const clearedKeys = (SecureStore.deleteItemAsync as jest.Mock).mock.calls.map(
        (call) => call[0],
      );
      expect(clearedKeys.some((k) => k.includes(previousAccountId))).toBe(true);
    });

    it('should not have window where both old and new tokens coexist under ambiguous keys', async () => {
      const userId = 'user-001';
      const oldToken = 'old-token';
      const newToken = 'new-token';

      const operations: string[] = [];

      (SecureStore.setItemAsync as jest.Mock).mockImplementation((key, value) => {
        operations.push(`set:${key}`);
        return Promise.resolve();
      });

      (SecureStore.deleteItemAsync as jest.Mock).mockImplementation((key) => {
        operations.push(`delete:${key}`);
        return Promise.resolve();
      });

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: 'encryption-key',
      });

      // Atomic operations: delete old, then set new
      await clearSecureTokens(userId);
      await storeSecureTokens({ token: newToken }, userId);

      // Ensure delete comes before set
      const deleteIdx = operations.findIndex((op) => op.startsWith('delete'));
      const setIdx = operations.findIndex((op) => op.startsWith('set'));
      expect(deleteIdx).toBeLessThan(setIdx);
    });
  });

  describe('No token leakage in logs', () => {
    it('should not log raw tokens or account IDs during namespacing', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      const userId = 'user-secret-id';
      const token = 'secret-token-value';

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: 'encryption-key',
      });

      await storeSecureTokens({ token }, userId);

      // Verify no raw values logged
      const allLogs = [...consoleSpy.mock.calls, ...errorSpy.mock.calls].flat();
      const logContent = allLogs.map((call) => JSON.stringify(call)).join('');
      expect(logContent).not.toContain(token);
      expect(logContent).not.toContain(userId);

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('iOS and Android platform differences', () => {
    it('should use platform-specific secure-store options', async () => {
      const userId = 'user-001';
      const token = 'test-token';

      let capturedOptions: any;
      (SecureStore.setItemAsync as jest.Mock).mockImplementation((key, value, options) => {
        capturedOptions = options;
        return Promise.resolve();
      });

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: 'encryption-key',
      });

      await storeSecureTokens({ token }, userId);

      // Verify options are set for restricted device access
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.keychainAccessible).toBeDefined();
    });
  });
});
