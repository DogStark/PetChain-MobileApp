jest.mock('react-native-ssl-pinning', () => ({ fetch: jest.fn() }));

const mockRequest = jest.fn();
jest.mock('axios', () => {
  const mockAxios = {
    create: jest.fn(() => mockAxios),
    request: mockRequest,
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  };
  return mockAxios;
});

jest.mock('../authService', () => ({
  getToken: jest.fn(),
  refreshToken: jest.fn(),
  logout: jest.fn(),
}));

jest.mock('../../config', () => ({
  api: {
    baseUrl: 'https://api.test.com',
    timeoutMs: 1000,
    version: '1.0',
  },
}));

import { getToken, refreshToken, logout } from '../authService';

let apiClient: any;
let resilientRequest: any;
let getCircuitState: any;
let _resetRefreshState: any;
let singleFlightRefreshForTest: any;
let requestInterceptor: (config: any) => any;

beforeAll(() => {
  const mod = require('../apiClient');
  apiClient = mod.default;
  resilientRequest = mod.resilientRequest;
  getCircuitState = mod.getCircuitState;
  _resetRefreshState = mod._resetRefreshState;
  singleFlightRefreshForTest = mod.singleFlightRefreshForTest;

  // Capture the request interceptor registered during module init (before clearAllMocks)
  const useMock = apiClient.interceptors.request.use as jest.Mock;
  const firstCall = useMock.mock.calls.find((call: any[]) => typeof call[0] === 'function');
  requestInterceptor = firstCall?.[0];
});

beforeEach(() => {
  mockRequest.mockReset();
  (getToken as jest.Mock).mockReset();
  (refreshToken as jest.Mock).mockReset();
  (logout as jest.Mock).mockReset();
  _resetRefreshState?.();
});

describe('interceptor', () => {
  it('adds Authorization header if token exists', async () => {
    (getToken as jest.Mock).mockResolvedValue('test-token');
    const result = await requestInterceptor({ headers: {} });
    expect(result.headers.Authorization).toBe('Bearer test-token');
  });

  it('omits Authorization header when no token', async () => {
    (getToken as jest.Mock).mockResolvedValue(null);
    const result = await requestInterceptor({ headers: {} });
    expect(result.headers.Authorization).toBeUndefined();
  });
});

describe('resilientRequest', () => {
  it('returns response on success', async () => {
    const mockResponse = { data: 'success' };
    mockRequest.mockResolvedValue(mockResponse);
    expect(await resilientRequest({ url: '/test' })).toBe(mockResponse);
    expect(getCircuitState()).toBe('CLOSED');
  });

  it('retries on 500 — calls request more than once before succeeding', async () => {
    // Exhaust all retries (3) to confirm retry loop runs; each attempt is fast since
    // mockRequest rejects synchronously and delay is skipped by immediately resolving on 4th
    mockRequest
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({ data: 'ok' });

    // Shorten delays to 0 for this test
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
      fn();
      return 0 as any;
    });
    try {
      const result = await resilientRequest({ url: '/test' });
      expect(result).toEqual({ data: 'ok' });
      expect(mockRequest).toHaveBeenCalledTimes(4); // initial + 3 retries
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('does not retry on 400', async () => {
    // 400 error is not 401, so the response interceptor re-rejects it
    // resilientRequest catches it and does not retry (shouldRetry returns false for 400)
    mockRequest.mockRejectedValue({ response: { status: 400 } });
    await expect(resilientRequest({ url: '/test' })).rejects.toThrow(
      'Request failed with status 400',
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('opens circuit after 5 failures', async () => {
    mockRequest.mockRejectedValue({ response: { status: 400 } });
    for (let i = 0; i < 5; i++) {
      try {
        await resilientRequest({ url: '/test' });
      } catch {
        /* expected */
      }
    }
    expect(getCircuitState()).toBe('OPEN');
    await expect(resilientRequest({ url: '/test' })).rejects.toThrow(
      'Service temporarily unavailable',
    );
  });
});

// ─── Single-flight token refresh (Issue #547) ────────────────────────────────

describe('single-flight token refresh', () => {
  it('3 concurrent calls only invoke refreshToken once', async () => {
    const newToken = 'refreshed';
    let resolve!: (t: string) => void;
    const pending = new Promise<string>((r) => {
      resolve = r;
    });
    (refreshToken as jest.Mock).mockReturnValue(pending);

    const p1 = singleFlightRefreshForTest();
    const p2 = singleFlightRefreshForTest();
    const p3 = singleFlightRefreshForTest();

    resolve(newToken);
    const results = await Promise.all([p1, p2, p3]);
    results.forEach((t: string) => expect(t).toBe(newToken));
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it('refresh failure calls logout and rejects', async () => {
    (refreshToken as jest.Mock).mockRejectedValue(new Error('refresh failed'));
    (logout as jest.Mock).mockResolvedValue(undefined);
    await expect(singleFlightRefreshForTest()).rejects.toThrow('refresh failed');
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
