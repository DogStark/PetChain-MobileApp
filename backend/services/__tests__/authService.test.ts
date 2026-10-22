import * as SecureStore from 'expo-secure-store';

import authService from '../authService';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('backend authService', () => {
  const mockToken = 'header.eyJlcnJvciI6Im5vbmUiLCJleHAiOjE5OTk5OTk5OTl9.signature'; // Exp in far future
  const expiredToken = 'header.eyJlcnJvciI6Im5vbmUiLCJleHAiOjEwMDAwMDAwMDB9.signature'; // Exp in past

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should store tokens and return auth response', async () => {
      const mockApiClient = {
        post: jest.fn().mockResolvedValue({
          data: {
            token: 'test-token',
            refreshToken: 'refresh-token',
            user: { id: '1' },
          },
        }),
      };

      const result = await authService.login({ email: 't@t.com', password: 'p' }, mockApiClient);

      expect(result.token).toBe('test-token');
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'test-token');
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith('refresh_token', 'refresh-token');
    });
  });

  describe('logout', () => {
    it('should delete tokens', async () => {
      await authService.logout();
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('refresh_token');
    });
  });

  describe('token validation', () => {
    it('should validate non-expired token', () => {
      expect(authService.validateToken(mockToken)).toBe(true);
    });

    it('should reject expired token', () => {
      expect(authService.validateToken(expiredToken)).toBe(false);
    });

    it('should reject malformed token', () => {
      expect(authService.validateToken('invalid')).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    it('should return true if valid token exists', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(mockToken);
      expect(await authService.isAuthenticated()).toBe(true);
    });

    it('should return false if no token exists', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
      expect(await authService.isAuthenticated()).toBe(false);
    });
  });
});
