/**
 * Unit tests for src/services/sessionMonitoringService.ts
 *
 * All external dependencies (axios/apiClient, AsyncStorage, config) are mocked
 * so these run cleanly in a Node/Jest environment with no native modules.
 */

// ─── Mocks (must be declared before imports) ──────────────────────────────────

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    api: {
      baseUrl: 'https://api.petchain.app/api',
      timeoutMs: 10000,
    },
    app: {
      name: 'PetChain',
      version: '1.2.3',
    },
    monitoring: {
      enabled: true,
      sampleRate: 1.0,
      sessionTimeoutMs: 1800000,
      crashFreeThreshold: 99.5,
    },
  },
}));

// In-memory AsyncStorage mock
const asyncStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(asyncStore[key] ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    asyncStore[key] = value;
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    delete asyncStore[key];
    return Promise.resolve();
  }),
}));

jest.mock('../apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

import apiClient from '../apiClient';
const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;

jest.useRealTimers();

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import sessionMonitoringService, {
  SessionMonitoringError,
  CRASH_FREE_THRESHOLD,
  type DeviceMetadata,
  type CrashFreeStats,
  type AlertPayload,
  type SessionStatus,
} from '../sessionMonitoringService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_DEVICE: DeviceMetadata = {
  model: 'iPhone 14 Pro',
  os: 'iOS',
  osVersion: '17.2',
  appVersion: '1.2.3',
  platform: 'ios',
};

const MOCK_CRASH_FREE_STATS: CrashFreeStats = {
  appVersion: '1.2.3',
  totalSessions: 1000,
  crashedSessions: 3,
  crashFreeRate: 99.7,
  isBelowThreshold: false,
  topCrashFlows: [
    { flow: 'qr_scan', crashCount: 2, percentage: 66.67 },
    { flow: 'blockchain_verify', crashCount: 1, percentage: 33.33 },
  ],
  byDevice: [{ model: 'iPhone 14 Pro', crashCount: 2, crashFreeRate: 99.8 }],
  byOsVersion: [{ os: 'iOS', osVersion: '17.2', crashCount: 2, crashFreeRate: 99.8 }],
  calculatedAt: '2026-05-29T10:00:00.000Z',
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  jest.clearAllMocks();
  Object.keys(asyncStore).forEach((k) => delete asyncStore[k]);

  // End any active session from a previous test
  const current = sessionMonitoringService.getCurrentSession();
  if (current) {
    mockPost.mockResolvedValueOnce({ data: { success: true, data: {} } });
    await sessionMonitoringService.endSession();
  }
});

// ─── CRASH_FREE_THRESHOLD constant ────────────────────────────────────────────

describe('CRASH_FREE_THRESHOLD', () => {
  it('is 99.5', () => {
    expect(CRASH_FREE_THRESHOLD).toBe(99.5);
  });
});

// ─── startSession() ───────────────────────────────────────────────────────────

describe('startSession()', () => {
  it('returns a session ID and sets current session', async () => {
    mockPost.mockResolvedValue({
      data: { success: true, data: { sessionId: 'x', recorded: true } },
    });

    const sessionId = await sessionMonitoringService.startSession(MOCK_DEVICE);

    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(0);

    const session = sessionMonitoringService.getCurrentSession();
    expect(session).not.toBeNull();
    expect(session?.status).toBe('active');
    expect(session?.device).toEqual(MOCK_DEVICE);
    expect(session?.appVersion).toBe('1.2.3');
    expect(session?.flowPath).toContain('app_launch');
  });

  it('sends session_start event to backend', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);

    // Should have called post at least once (events flush + session start)
    expect(mockPost).toHaveBeenCalled();
    const calls = mockPost.mock.calls.map((c) => c[0] as string);
    expect(calls.some((url) => url.includes('/monitoring/sessions/start'))).toBe(true);
  });

  it('ends an existing active session before starting a new one', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    const firstId = await sessionMonitoringService.startSession(MOCK_DEVICE);
    const secondId = await sessionMonitoringService.startSession(MOCK_DEVICE);

    expect(firstId).not.toBe(secondId);
    expect(sessionMonitoringService.getCurrentSessionId()).toBe(secondId);
  });

  it('persists session to AsyncStorage', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);

    const stored = asyncStore['@session_monitoring:current_session'];
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored);
    expect(parsed.status).toBe('active');
    expect(parsed.device.model).toBe('iPhone 14 Pro');
  });
});

// ─── endSession() ─────────────────────────────────────────────────────────────

describe('endSession()', () => {
  it('marks session as ended and clears current session', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.endSession();

    expect(sessionMonitoringService.getCurrentSession()).toBeNull();
  });

  it('sends session_end event to backend', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    mockPost.mockClear();
    await sessionMonitoringService.endSession();

    const calls = mockPost.mock.calls.map((c) => c[0] as string);
    expect(calls.some((url) => url.includes('/monitoring/sessions/end'))).toBe(true);
  });

  it('removes session from AsyncStorage after ending', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    expect(asyncStore['@session_monitoring:current_session']).toBeDefined();

    await sessionMonitoringService.endSession();
    expect(asyncStore['@session_monitoring:current_session']).toBeUndefined();
  });

  it('is a no-op when no session is active', async () => {
    // Should not throw
    await expect(sessionMonitoringService.endSession()).resolves.toBeUndefined();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('notifies status listeners on end', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    const listener = jest.fn();
    const unsubscribe = sessionMonitoringService.onStatusChange(listener);

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.endSession();

    expect(listener).toHaveBeenCalledWith('ended');
    unsubscribe();
  });
});

// ─── trackNavigation() ────────────────────────────────────────────────────────

describe('trackNavigation()', () => {
  it('updates active flow and appends to flowPath', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.trackNavigation('pet_list', 'PetListScreen');

    expect(sessionMonitoringService.getActiveFlow()).toBe('pet_list');

    const session = sessionMonitoringService.getCurrentSession();
    expect(session?.flowPath).toContain('pet_list');
  });

  it('is a no-op when no session is active', async () => {
    // Should not throw
    await expect(sessionMonitoringService.trackNavigation('pet_list')).resolves.toBeUndefined();
  });

  it('tracks multiple navigation steps in order', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.trackNavigation('login');
    await sessionMonitoringService.trackNavigation('pet_list');
    await sessionMonitoringService.trackNavigation('pet_detail');

    const session = sessionMonitoringService.getCurrentSession();
    expect(session?.flowPath).toEqual(
      expect.arrayContaining(['app_launch', 'login', 'pet_list', 'pet_detail']),
    );
  });
});

// ─── trackError() ─────────────────────────────────────────────────────────────

describe('trackError()', () => {
  it('increments error count on the session', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.trackError(new Error('API timeout'));
    await sessionMonitoringService.trackError(new Error('Validation failed'));

    const session = sessionMonitoringService.getCurrentSession();
    expect(session?.errorCount).toBe(2);
  });

  it('does not end the session (non-fatal)', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.trackError(new Error('Non-fatal error'));

    expect(sessionMonitoringService.getCurrentSession()?.status).toBe('active');
  });

  it('is a no-op when no session is active', async () => {
    await expect(
      sessionMonitoringService.trackError(new Error('orphan error')),
    ).resolves.toBeUndefined();
  });
});

// ─── reportCrash() ────────────────────────────────────────────────────────────

describe('reportCrash()', () => {
  it('marks session as crashed and ends it', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.reportCrash(new Error('Fatal crash'));

    // Session should be cleared after crash
    expect(sessionMonitoringService.getCurrentSession()).toBeNull();
  });

  it('sends crash report to backend', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.reportCrash(new Error('NullPointerException'));

    const calls = mockPost.mock.calls.map((c) => c[0] as string);
    expect(calls.some((url) => url.includes('/monitoring/crashes'))).toBe(true);
  });

  it('includes the active flow in the crash report', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.trackNavigation('qr_scan');
    await sessionMonitoringService.reportCrash(new Error('Camera crash'));

    const crashCall = mockPost.mock.calls.find((c) =>
      (c[0] as string).includes('/monitoring/crashes'),
    );
    expect(crashCall).toBeDefined();
    expect(crashCall?.[1]).toMatchObject({ activeFlow: 'qr_scan' });
  });

  it('notifies status listeners with "crashed"', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    const listener = jest.fn();
    const unsubscribe = sessionMonitoringService.onStatusChange(listener);

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.reportCrash(new Error('Crash'));

    expect(listener).toHaveBeenCalledWith('crashed');
    unsubscribe();
  });

  it('handles crash outside of a tracked session without throwing', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    // No session started
    await expect(
      sessionMonitoringService.reportCrash(new Error('Orphan crash')),
    ).resolves.toBeUndefined();
  });

  it('persists crash locally when backend call fails', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } }); // session start
    await sessionMonitoringService.startSession(MOCK_DEVICE);

    // Make crash report POST fail
    mockPost.mockRejectedValue(new Error('Network error'));

    await sessionMonitoringService.reportCrash(new Error('Crash with network failure'));

    const stored = asyncStore['@session_monitoring:crash_history'];
    expect(stored).toBeDefined();
    const history = JSON.parse(stored);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].error).toBe('Crash with network failure');
  });
});

// ─── trackUserAction() ────────────────────────────────────────────────────────

describe('trackUserAction()', () => {
  it('tracks a user action event and flushes it to the backend', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    mockPost.mockClear();

    await sessionMonitoringService.trackUserAction('tap_add_pet', { source: 'fab' });

    // Allow the async flush to complete
    await new Promise((r) => setTimeout(r, 10));

    // Events are flushed via POST /monitoring/events
    const eventsCalls = mockPost.mock.calls.filter((c) =>
      (c[0] as string).includes('/monitoring/events'),
    );
    expect(eventsCalls.length).toBeGreaterThan(0);

    const payload = eventsCalls[0][1] as {
      events: Array<{ type: string; data: { action?: string } }>;
    };
    const actionEvent = payload.events.find((e) => e.type === 'user_action');
    expect(actionEvent).toBeDefined();
    expect(actionEvent?.data.action).toBe('tap_add_pet');
  });

  it('is a no-op when no session is active', async () => {
    await expect(sessionMonitoringService.trackUserAction('tap_button')).resolves.toBeUndefined();
  });
});

// ─── getCrashFreeStats() ──────────────────────────────────────────────────────

describe('getCrashFreeStats()', () => {
  it('returns crash-free stats from the backend', async () => {
    mockGet.mockResolvedValueOnce({
      data: { success: true, data: MOCK_CRASH_FREE_STATS },
    });

    const stats = await sessionMonitoringService.getCrashFreeStats('1.2.3');

    expect(stats.appVersion).toBe('1.2.3');
    expect(stats.crashFreeRate).toBe(99.7);
    expect(stats.isBelowThreshold).toBe(false);
    expect(stats.topCrashFlows).toHaveLength(2);
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('/monitoring/analytics/crash-free'),
    );
  });

  it('fires alert listeners when rate is below threshold', async () => {
    const belowThresholdStats: CrashFreeStats = {
      ...MOCK_CRASH_FREE_STATS,
      crashFreeRate: 99.1,
      isBelowThreshold: true,
    };

    mockGet.mockResolvedValueOnce({
      data: { success: true, data: belowThresholdStats },
    });
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    const alertListener = jest.fn();
    const unsubscribe = sessionMonitoringService.onAlert(alertListener);

    await sessionMonitoringService.getCrashFreeStats('1.2.3');

    expect(alertListener).toHaveBeenCalledWith(
      expect.objectContaining<Partial<AlertPayload>>({
        type: 'crash_free_rate_below_threshold',
        currentRate: 99.1,
        threshold: CRASH_FREE_THRESHOLD,
      }),
    );

    unsubscribe();
  });

  it('sends alert to backend when rate is below threshold', async () => {
    const belowThresholdStats: CrashFreeStats = {
      ...MOCK_CRASH_FREE_STATS,
      crashFreeRate: 98.0,
      isBelowThreshold: true,
    };

    mockGet.mockResolvedValueOnce({
      data: { success: true, data: belowThresholdStats },
    });
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.getCrashFreeStats();

    const calls = mockPost.mock.calls.map((c) => c[0] as string);
    expect(calls.some((url) => url.includes('/monitoring/alerts'))).toBe(true);
  });

  it('does not fire alert when rate is above threshold', async () => {
    mockGet.mockResolvedValueOnce({
      data: { success: true, data: MOCK_CRASH_FREE_STATS },
    });

    const alertListener = jest.fn();
    const unsubscribe = sessionMonitoringService.onAlert(alertListener);

    await sessionMonitoringService.getCrashFreeStats();

    expect(alertListener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('throws SessionMonitoringError when backend call fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network failure'));

    await expect(sessionMonitoringService.getCrashFreeStats()).rejects.toMatchObject({
      name: 'SessionMonitoringError',
      code: 'STATS_FETCH_FAILED',
    });
  });
});

// ─── recoverInterruptedSession() ──────────────────────────────────────────────

describe('recoverInterruptedSession()', () => {
  it('returns null when no persisted session exists', async () => {
    const result = await sessionMonitoringService.recoverInterruptedSession();
    expect(result).toBeNull();
  });

  it('recovers and reports an abnormally terminated session', async () => {
    // Simulate a stale active session (started 2 hours ago)
    const staleSession = {
      id: 'stale-session-1',
      status: 'active',
      startedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
      device: MOCK_DEVICE,
      appVersion: '1.2.3',
      flowPath: ['app_launch', 'pet_list'],
      hasCrash: false,
      errorCount: 0,
    };

    asyncStore['@session_monitoring:current_session'] = JSON.stringify(staleSession);
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    const recovered = await sessionMonitoringService.recoverInterruptedSession();

    expect(recovered).not.toBeNull();
    expect(recovered?.id).toBe('stale-session-1');
    expect(recovered?.status).toBe('abnormal');

    // Should have reported the abnormal termination
    const calls = mockPost.mock.calls.map((c) => c[0] as string);
    expect(calls.some((url) => url.includes('/monitoring/sessions/end'))).toBe(true);

    // Should have cleared the persisted session
    expect(asyncStore['@session_monitoring:current_session']).toBeUndefined();
  });

  it('does not recover a recently active session (within timeout)', async () => {
    const recentSession = {
      id: 'recent-session-1',
      status: 'active',
      startedAt: Date.now() - 5 * 60 * 1000, // 5 minutes ago (within 30min timeout)
      device: MOCK_DEVICE,
      appVersion: '1.2.3',
      flowPath: ['app_launch'],
      hasCrash: false,
      errorCount: 0,
    };

    asyncStore['@session_monitoring:current_session'] = JSON.stringify(recentSession);

    const recovered = await sessionMonitoringService.recoverInterruptedSession();

    // Should return null — session is still within timeout window
    expect(recovered).toBeNull();
  });
});

// ─── onStatusChange() ─────────────────────────────────────────────────────────

describe('onStatusChange()', () => {
  it('returns an unsubscribe function that stops notifications', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    const listener = jest.fn();
    const unsubscribe = sessionMonitoringService.onStatusChange(listener);

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.endSession();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    listener.mockClear();

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    await sessionMonitoringService.endSession();
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── onAlert() ────────────────────────────────────────────────────────────────

describe('onAlert()', () => {
  it('returns an unsubscribe function that stops alert notifications', async () => {
    const belowThresholdStats: CrashFreeStats = {
      ...MOCK_CRASH_FREE_STATS,
      crashFreeRate: 98.0,
      isBelowThreshold: true,
    };

    const alertListener = jest.fn();
    const unsubscribe = sessionMonitoringService.onAlert(alertListener);
    unsubscribe(); // Immediately unsubscribe

    mockGet.mockResolvedValueOnce({
      data: { success: true, data: belowThresholdStats },
    });
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.getCrashFreeStats();

    expect(alertListener).not.toHaveBeenCalled();
  });
});

// ─── SessionMonitoringError ───────────────────────────────────────────────────

describe('SessionMonitoringError', () => {
  it('has correct name, code, and message', () => {
    const err = new SessionMonitoringError('something went wrong', 'TEST_CODE');
    expect(err.name).toBe('SessionMonitoringError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('something went wrong');
    expect(err instanceof Error).toBe(true);
  });
});

// ─── Event buffering ──────────────────────────────────────────────────────────

describe('event buffering', () => {
  it('buffers events and flushes them to the backend', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });

    await sessionMonitoringService.startSession(MOCK_DEVICE);
    mockPost.mockClear();

    await sessionMonitoringService.trackNavigation('pet_list');

    // Allow the async flush to complete
    await new Promise((r) => setTimeout(r, 10));

    // Events should have been flushed via POST /monitoring/events
    const eventsCalls = mockPost.mock.calls.filter((c) =>
      (c[0] as string).includes('/monitoring/events'),
    );
    expect(eventsCalls.length).toBeGreaterThan(0);

    const payload = eventsCalls[0][1] as { events: unknown[] };
    expect(Array.isArray(payload.events)).toBe(true);
    expect(payload.events.length).toBeGreaterThan(0);
  });

  it('does not throw when backend flush fails', async () => {
    // Start session succeeds
    mockPost.mockResolvedValueOnce({ data: { success: true, data: {} } });
    await sessionMonitoringService.startSession(MOCK_DEVICE);

    // All subsequent posts fail
    mockPost.mockRejectedValue(new Error('Network down'));

    // Should not throw
    await expect(sessionMonitoringService.trackNavigation('pet_detail')).resolves.toBeUndefined();
  });
});
