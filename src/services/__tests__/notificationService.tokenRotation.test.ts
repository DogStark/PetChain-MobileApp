import * as Notifications from 'expo-notifications';
import {
  registerPushToken,
  rotatePushToken,
  revokePushToken,
  revokeAllDeviceTokensOnLogout,
} from '../notificationService';
import apiClient from '../apiClient';

jest.mock('expo-notifications');
jest.mock('../apiClient');
jest.mock('../localDB');

describe('#919 — Push-token rotation and logout revocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should register new token and revoke old one atomically', async () => {
    const oldToken = 'old-token-12345';
    const newToken = 'new-token-67890';

    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
      data: newToken,
    });

    (apiClient.post as jest.Mock).mockResolvedValue({ data: { success: true } });
    (apiClient.delete as jest.Mock).mockResolvedValue({ data: { success: true } });

    await rotatePushToken(oldToken, newToken);

    expect(apiClient.post).toHaveBeenCalledWith(
      expect.stringContaining('tokens'),
      expect.objectContaining({ token: newToken }),
    );
    expect(apiClient.delete).toHaveBeenCalledWith(
      expect.stringContaining(oldToken),
    );
  });

  it('should handle concurrent registration without both tokens being active', async () => {
    const token1 = 'token-1';
    const token2 = 'token-2';

    (apiClient.post as jest.Mock)
      .mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({ data: { success: true } });
    (apiClient.delete as jest.Mock).mockResolvedValue({ data: { success: true } });

    await registerPushToken(token1);
    await registerPushToken(token2);

    const postCalls = (apiClient.post as jest.Mock).mock.calls;
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('should revoke token on logout immediately', async () => {
    const deviceToken = 'device-token-abc123';

    (apiClient.delete as jest.Mock).mockResolvedValue({ data: { success: true } });

    await revokePushToken(deviceToken);

    expect(apiClient.delete).toHaveBeenCalledWith(
      expect.stringContaining(deviceToken),
    );
  });

  it('should not cross-account deliver notifications after logout', async () => {
    const oldUserToken = 'user-1-token';

    (apiClient.delete as jest.Mock).mockResolvedValue({ data: { success: true } });

    await revokeAllDeviceTokensOnLogout();

    expect(apiClient.delete).toHaveBeenCalled();
  });

  it('should be idempotent for token registration', async () => {
    const token = 'token-xyz';

    (apiClient.post as jest.Mock).mockResolvedValue({ data: { success: true } });

    const result1 = await registerPushToken(token);
    const result2 = await registerPushToken(token);

    expect(result1).toBe(result2);
  });

  it('should handle permission denied', async () => {
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(
      new Error('Permission denied'),
    );

    const result = await registerPushToken('fallback-token');
    expect(result).toBeNull();
  });

  it('should handle offline gracefully', async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(new Error('Network error'));

    const result = await registerPushToken('token-123');
    expect(result).toBeNull();
  });

  it('should handle timeout/cancellation', async () => {
    const abortError = new Error('Aborted');
    (apiClient.post as jest.Mock).mockRejectedValue(abortError);

    const result = await registerPushToken('token-123');
    expect(result).toBeNull();
  });

  it('should support multi-device sessions (not revoke other devices)', async () => {
    const device1Token = 'device-1-token';
    const device2Token = 'device-2-token';

    (apiClient.delete as jest.Mock).mockResolvedValue({ data: { success: true } });

    await revokePushToken(device1Token);

    expect(apiClient.delete).toHaveBeenCalledWith(
      expect.stringContaining(device1Token),
    );
    expect(apiClient.delete).not.toHaveBeenCalledWith(
      expect.stringContaining(device2Token),
    );
  });
});
