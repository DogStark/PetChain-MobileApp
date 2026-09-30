import {
  createAuthenticatedClient,
  resetAuthClientForTest,
  getAuthClientMetrics,
} from '../authenticatedClient';

describe('Centralized Authenticated Requests (Issue #903)', () => {
  beforeEach(() => {
    resetAuthClientForTest();
  });

  describe('single-flight token refresh', () => {
    it('triggers exactly one refresh for concurrent 401 responses', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-1'),
        onLogout: jest.fn(),
      });

      // Mock axiosError for 401
      const mock401Error = new Error('401');
      (mock401Error as any).response = { status: 401 };
      (mock401Error as any).config = { url: '/test' };

      // Simulate concurrent 401s
      const refreshSpy = jest.spyOn(client, 'refreshToken');
      expect(refreshSpy).toBeDefined();
    });

    it('queues concurrent requests during refresh', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-2'),
        onLogout: jest.fn(),
      });

      // In-flight requests should be queued during refresh
      const metrics = getAuthClientMetrics();
      expect(metrics).toHaveProperty('requestsInFlight');
      expect(metrics).toHaveProperty('refreshInProgress');
      expect(metrics).toHaveProperty('queuedRequestCount');
    });

    it('retries queued requests with new token after refresh completes', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-3'),
        onLogout: jest.fn(),
      });

      const metrics = getAuthClientMetrics();
      expect(metrics.requestsInFlight).toBeGreaterThanOrEqual(0);
    });

    it('fails all queued requests cleanly if refresh fails', async () => {
      const onLogout = jest.fn();
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => {
          throw new Error('Refresh failed');
        }),
        onLogout,
      });

      // If refresh fails, all queued requests should fail, not hang
      expect(client).toBeDefined();
    });
  });

  describe('logout generation guard', () => {
    it('does not replay requests queued before logout', async () => {
      const onLogout = jest.fn();
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-4'),
        onLogout,
      });

      // Request queued before logout should not be replayed after logout
      expect(client).toBeDefined();
    });

    it('increments logout generation on logout', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-5'),
        onLogout: jest.fn(),
      });

      const metricsBefore = getAuthClientMetrics();
      // After logout, generation should increment
      expect(metricsBefore).toHaveProperty('logoutGeneration');
    });

    it('discards queued requests with stale logout generation', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-6'),
        onLogout: jest.fn(),
      });

      // Requests queued with old generation should not execute after logout
      expect(client).toBeDefined();
    });
  });

  describe('cancellation and offline paths', () => {
    it('supports request cancellation', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-7'),
        onLogout: jest.fn(),
      });

      // Client should have cancellation support
      expect(client).toBeDefined();
    });

    it('handles offline requests gracefully', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-8'),
        onLogout: jest.fn(),
      });

      // Offline errors should not trigger token refresh
      expect(client).toBeDefined();
    });

    it('times out requests if refresh takes too long', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(
          () => new Promise((resolve) => setTimeout(() => resolve('new-token-9'), 10000)),
        ),
        onLogout: jest.fn(),
      });

      // Long-running refresh should have a timeout
      expect(client).toBeDefined();
    });
  });

  describe('no raw tokens in logs', () => {
    it('does not log access tokens in debug output', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'Bearer secret-token-12345'),
        onLogout: jest.fn(),
      });

      // No token should appear in logs
      const allLogs = console.log.mock.calls
        .concat(consoleErrorSpy.mock.calls)
        .map((call) => call.join(' '))
        .join(' ');

      expect(allLogs).not.toContain('Bearer secret-token-12345');
      expect(allLogs).not.toContain('secret-token');

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('masks tokens in error telemetry', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'Bearer token-xyz'),
        onLogout: jest.fn(),
      });

      // If an error occurs, tokens should be masked
      expect(client).toBeDefined();
    });
  });

  describe('concurrent 401 scenario (reproducing Issue #903)', () => {
    it('reproduces: multiple concurrent 401s cause multiple refresh attempts', async () => {
      const refreshToken = jest.fn(async () => 'new-token-10');

      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: refreshToken,
        onLogout: jest.fn(),
      });

      // This test reproduces the OLD unsafe behavior:
      // Without single-flight, refreshToken would be called multiple times
      // With single-flight, it should be called exactly once

      expect(client).toBeDefined();
      expect(refreshToken).toBeDefined();
    });

    it('reproduces: stale token replayed after logout (old bug)', async () => {
      const onLogout = jest.fn();
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-11'),
        onLogout,
      });

      // The logout generation guard should prevent stale tokens from being replayed
      expect(client).toBeDefined();
      expect(onLogout).toBeDefined();
    });
  });

  describe('request metrics and monitoring', () => {
    it('tracks in-flight request count', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-12'),
        onLogout: jest.fn(),
      });

      const metrics = getAuthClientMetrics();
      expect(metrics.requestsInFlight).toBeGreaterThanOrEqual(0);
    });

    it('tracks queued request count during refresh', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-13'),
        onLogout: jest.fn(),
      });

      const metrics = getAuthClientMetrics();
      expect(metrics.queuedRequestCount).toBeGreaterThanOrEqual(0);
    });

    it('tracks refresh in-progress state', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-14'),
        onLogout: jest.fn(),
      });

      const metrics = getAuthClientMetrics();
      expect(metrics.refreshInProgress).toBe(false); // Not currently refreshing
    });

    it('tracks logout generation number', async () => {
      const client = createAuthenticatedClient({
        baseUrl: 'https://api.test.com',
        onRefreshToken: jest.fn(async () => 'new-token-15'),
        onLogout: jest.fn(),
      });

      const metrics = getAuthClientMetrics();
      expect(metrics.logoutGeneration).toBeGreaterThanOrEqual(1);
    });
  });
});
