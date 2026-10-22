import apiClient, { resilientRequest, getCircuitState } from '../apiClient';

jest.mock('axios', () => {
  const mockAxios = {
    create: jest.fn(() => mockAxios),
    request: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return mockAxios;
});

describe('backend apiClient resilientRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Reset circuit state if possible - since it's a module level variable, we might need to be careful
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should succeed on first attempt', async () => {
    (apiClient.request as jest.Mock).mockResolvedValue({ data: 'success' });

    const response = await resilientRequest({ url: '/test' });

    expect(response.data).toBe('success');
    expect(apiClient.request).toHaveBeenCalledTimes(1);
  });

  it('should retry on 500 error', async () => {
    (apiClient.request as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({ data: 'success' });

    const promise = resilientRequest({ url: '/test' });

    // Fast-forward through delays
    await jest.runAllTimersAsync();

    const response = await promise;
    expect(response.data).toBe('success');
    expect(apiClient.request).toHaveBeenCalledTimes(2);
  });

  it('should open circuit after multiple failures', async () => {
    (apiClient.request as jest.Mock).mockRejectedValue({ response: { status: 500 } });

    // Try multiple times to trigger circuit breaker (threshold is 5)
    for (let i = 0; i < 5; i++) {
      try {
        const p = resilientRequest({ url: '/test' });
        await jest.runAllTimersAsync();
        await p;
      } catch {
        // expected
      }
    }

    expect(getCircuitState()).toBe('OPEN');

    // Next request should fail immediately without calling apiClient.request
    await expect(resilientRequest({ url: '/test' })).rejects.toThrow(
      'Service temporarily unavailable',
    );
    expect(apiClient.request).toHaveBeenCalledTimes(5); // Not called for the 6th time
  });

  it('should transition to HALF_OPEN after recovery timeout', async () => {
    // Force OPEN state
    (apiClient.request as jest.Mock).mockRejectedValue({ response: { status: 500 } });
    for (let i = 0; i < 5; i++) {
      try {
        const p = resilientRequest({ url: '/test' });
        await jest.runAllTimersAsync();
        await p;
      } catch {
        // expected
      }
    }
    expect(getCircuitState()).toBe('OPEN');

    // Advance time by 30s (RECOVERY_TIMEOUT_MS)
    jest.advanceTimersByTime(30000);

    // Should now allow a request (HALF_OPEN)
    (apiClient.request as jest.Mock).mockResolvedValue({ data: 'recovered' });
    const response = await resilientRequest({ url: '/test' });
    expect(response.data).toBe('recovered');
    expect(getCircuitState()).toBe('CLOSED');
  });
});
