/**
 * Unit tests for the rate limiting / debouncing / request deduplication
 * layer added to src/services/apiClient.ts (Issue #XXX).
 *
 * These tests cover:
 *  - Debounce: rapid successive calls resolve to a single network request
 *  - Deduplication: identical in-flight requests share one Promise
 *  - Max concurrency: requests queue when the concurrent limit is exceeded
 *  - setMaxConcurrentRequests: runtime configuration
 */

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
  getToken: jest.fn().mockResolvedValue(null),
  refreshToken: jest.fn(),
  logout: jest.fn(),
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    api: { baseUrl: 'https://api.test.com', timeoutMs: 1000, version: '1.0' },
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

let rateLimitedRequest: (cfg: any) => Promise<any>;
let setMaxConcurrentRequests: (n: number) => void;
let _getRateLimitState: () => {
  activeRequests: number;
  inflightCount: number;
  debounceCount: number;
  queueLength: number;
  maxConcurrent: number;
};
let _resetRateLimitState: () => void;

beforeAll(() => {
  const mod = require('../apiClient');
  rateLimitedRequest = mod.rateLimitedRequest;
  setMaxConcurrentRequests = mod.setMaxConcurrentRequests;
  _getRateLimitState = mod._getRateLimitState;
  _resetRateLimitState = mod._resetRateLimitState;
});

beforeEach(() => {
  mockRequest.mockReset();
  _resetRateLimitState?.();
  // Default: each request resolves immediately
  mockRequest.mockResolvedValue({ data: 'ok', status: 200 });
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Debounce ─────────────────────────────────────────────────────────────────

describe('debounce behaviour', () => {
  it('fires only one network request when called rapidly with debounce:true', async () => {
    jest.useFakeTimers();

    const cfg = { method: 'GET', url: '/search', params: { q: 'dog' }, debounce: true };

    // Fire 3 rapid calls — only the last one should reach the network
    const p1 = rateLimitedRequest(cfg);
    const p2 = rateLimitedRequest(cfg);
    const p3 = rateLimitedRequest(cfg);

    // Advance timers past the 300 ms window
    jest.advanceTimersByTime(350);

    await Promise.all([p1, p2, p3]);

    // The axios `request` mock should have been called exactly once
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('fires the request immediately (no debounce window) when debounce is not set', async () => {
    const cfg = { method: 'GET', url: '/pets' };
    await rateLimitedRequest(cfg);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

// ─── Request deduplication ────────────────────────────────────────────────────

describe('request deduplication', () => {
  it('returns the same Promise for identical concurrent requests', async () => {
    let resolveRequest!: (value: any) => void;
    mockRequest.mockReturnValue(
      new Promise<any>((r) => {
        resolveRequest = r;
      }),
    );

    const cfg = { method: 'GET', url: '/pets' };

    const p1 = rateLimitedRequest(cfg);
    const p2 = rateLimitedRequest(cfg);
    const p3 = rateLimitedRequest(cfg);

    // Should only have started one real request
    expect(mockRequest).toHaveBeenCalledTimes(1);

    resolveRequest({ data: 'deduped', status: 200 });
    const results = await Promise.all([p1, p2, p3]);
    results.forEach((r) => expect(r.data).toBe('deduped'));
    // Still only one network call
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('starts a new request after the first one completes', async () => {
    const cfg = { method: 'GET', url: '/pets' };

    await rateLimitedRequest(cfg);
    await rateLimitedRequest(cfg);

    // Each call resolved independently — two network requests
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('treats different URLs as different requests (no dedup)', async () => {
    const p1 = rateLimitedRequest({ method: 'GET', url: '/pets' });
    const p2 = rateLimitedRequest({ method: 'GET', url: '/appointments' });

    await Promise.all([p1, p2]);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('treats different params as different requests (no dedup)', async () => {
    const p1 = rateLimitedRequest({ method: 'GET', url: '/search', params: { q: 'dog' } });
    const p2 = rateLimitedRequest({ method: 'GET', url: '/search', params: { q: 'cat' } });

    await Promise.all([p1, p2]);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('is param-order insensitive for the same query', async () => {
    let resolveRequest!: (value: any) => void;
    mockRequest.mockReturnValueOnce(
      new Promise<any>((r) => {
        resolveRequest = r;
      }),
    );

    const p1 = rateLimitedRequest({ method: 'GET', url: '/search', params: { q: 'dog', page: 1 } });
    const p2 = rateLimitedRequest({ method: 'GET', url: '/search', params: { page: 1, q: 'dog' } });

    expect(mockRequest).toHaveBeenCalledTimes(1);

    resolveRequest({ data: 'same', status: 200 });
    await Promise.all([p1, p2]);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

// ─── Max concurrency ─────────────────────────────────────────────────────────

describe('max concurrency', () => {
  it('queues requests when concurrency limit is reached', async () => {
    setMaxConcurrentRequests(2);

    const resolvers: Array<(v: any) => void> = [];
    mockRequest.mockImplementation(
      () => new Promise<any>((r) => resolvers.push(r)),
    );

    const p1 = rateLimitedRequest({ method: 'GET', url: '/a' });
    const p2 = rateLimitedRequest({ method: 'GET', url: '/b' });
    const p3 = rateLimitedRequest({ method: 'GET', url: '/c' }); // queued

    // Only 2 requests should have started
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(_getRateLimitState().queueLength).toBe(1);

    // Resolve one, which should unblock the queued request
    resolvers[0]!({ data: 'a', status: 200 });
    await p1;

    // Now the 3rd should start
    expect(mockRequest).toHaveBeenCalledTimes(3);

    resolvers[1]!({ data: 'b', status: 200 });
    resolvers[2]!({ data: 'c', status: 200 });
    await Promise.all([p2, p3]);
  });

  it('setMaxConcurrentRequests updates the limit', () => {
    setMaxConcurrentRequests(5);
    expect(_getRateLimitState().maxConcurrent).toBe(5);
  });

  it('ignores setMaxConcurrentRequests(0) (must be positive)', () => {
    setMaxConcurrentRequests(3);
    setMaxConcurrentRequests(0);
    expect(_getRateLimitState().maxConcurrent).toBe(3);
  });
});
