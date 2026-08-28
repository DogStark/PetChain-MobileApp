/**
 * Unit tests for src/services/tokenRefreshScheduler.ts
 */

const mockRefreshToken = jest.fn();

jest.mock('../authService', () => ({
  refreshToken: mockRefreshToken,
}));

import { scheduleTokenRefresh } from '../tokenRefreshScheduler';

describe('scheduleTokenRefresh()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls authService.refreshToken()', async () => {
    mockRefreshToken.mockResolvedValue(undefined);
    await scheduleTokenRefresh();
    expect(mockRefreshToken).toHaveBeenCalledTimes(1);
  });

  it('does not throw when refreshToken rejects', async () => {
    mockRefreshToken.mockRejectedValue(new Error('Network error'));
    await expect(scheduleTokenRefresh()).resolves.toBeUndefined();
  });
});
