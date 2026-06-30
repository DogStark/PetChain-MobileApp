// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRedisData: Record<string, unknown> = {};
const mockSets: Record<string, Set<string>> = {};
const mockLists: Record<string, string[]> = {};

const mockRedisClient = {
  set: jest.fn(async (key: string, val: string, ...args: unknown[]) => {
    const nxIdx = args.indexOf('NX');
    if (nxIdx !== -1 && mockRedisData[key] !== undefined) return null;
    mockRedisData[key] = val;
    return 'OK';
  }),
  get: jest.fn(async (key: string) => (mockRedisData[key] as string) ?? null),
  del: jest.fn(async (key: string) => {
    delete mockRedisData[key];
    delete mockSets[key];
    delete mockLists[key];
    return 1;
  }),
  sadd: jest.fn(async (key: string, ...members: string[]) => {
    if (!mockSets[key]) mockSets[key] = new Set();
    members.forEach((m) => mockSets[key].add(m));
    return members.length;
  }),
  srem: jest.fn(async (key: string, member: string) => {
    mockSets[key]?.delete(member);
    return 1;
  }),
  smembers: jest.fn(async (key: string) => [...(mockSets[key] ?? [])]),
  sismember: jest.fn(async (key: string, member: string) => (mockSets[key]?.has(member) ? 1 : 0)),
  rpush: jest.fn(async (key: string, val: string) => {
    if (!mockLists[key]) mockLists[key] = [];
    mockLists[key].push(val);
    return mockLists[key].length;
  }),
  lpop: jest.fn(async (key: string) => {
    if (!mockLists[key]?.length) return null;
    return mockLists[key].shift() ?? null;
  }),
  lrange: jest.fn(async (key: string, start: number, end: number) => {
    const list = mockLists[key] ?? [];
    return end === -1 ? list.slice(start) : list.slice(start, end + 1);
  }),
  hincrby: jest.fn(async (key: string, field: string, incr: number) => {
    if (!mockRedisData[key]) mockRedisData[key] = {};
    const h = mockRedisData[key] as Record<string, number>;
    h[field] = (h[field] ?? 0) + incr;
    return h[field];
  }),
  hgetall: jest.fn(async (key: string) => {
    const h = mockRedisData[key] as Record<string, number> | undefined;
    if (!h) return null;
    return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, String(v)]));
  }),
  zadd: jest.fn(async (_key: string, _score: number, _val: string) => 1),
  zrangebyscore: jest.fn(async () => []),
  zrem: jest.fn(async () => 1),
  zrange: jest.fn(async () => []),
};

jest.mock('../../config/redis', () => ({
  getRedisClient: () => mockRedisClient,
  REDIS_KEY_PREFIX: 'petchain:',
}));

jest.mock('node-fetch');

// ─── Imports ──────────────────────────────────────────────────────────────────

import fetch from 'node-fetch';

import {
  clearDLQ,
  drainQueue,
  enqueue,
  getDLQ,
  getMetrics,
  getPreferences,
  getSubscriptions,
  getTokens,
  isSubscribed,
  processOne,
  registerToken,
  removeAllTokens,
  removeToken,
  sendToUser,
  setPreferences,
  subscribe,
  unsubscribe,
} from '../pushService';

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function expoOkResponse(receiptId = 'receipt-test-1') {
  return {
    ok: true,
    json: async () => ({ data: { status: 'ok', id: receiptId } }),
  } as unknown as ReturnType<typeof fetch>;
}

function expoErrorResponse(error = 'MessageRateExceeded') {
  return {
    ok: true,
    json: async () => ({ data: { status: 'error', details: { error } } }),
  } as unknown as ReturnType<typeof fetch>;
}

function expoHttpError(status = 500) {
  return { ok: false, status } as unknown as ReturnType<typeof fetch>;
}

const USER = 'user-1';
const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const TOPIC = 'medication_reminders' as const;

async function setupSubscribedUser() {
  await registerToken(USER, TOKEN);
  await subscribe(USER, TOPIC);
  // Default prefs have all topics enabled
}

function makeJob(overrides: Partial<Parameters<typeof enqueue>[0]> = {}) {
  return {
    jobId: `job-${Date.now()}-${Math.random()}`,
    userId: USER,
    token: TOKEN,
    title: 'Test',
    body: 'Test body',
    topic: TOPIC,
    ...overrides,
  };
}

// ─── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  Object.keys(mockRedisData).forEach((k) => delete mockRedisData[k]);
  Object.keys(mockSets).forEach((k) => delete mockSets[k]);
  Object.keys(mockLists).forEach((k) => delete mockLists[k]);
  jest.clearAllMocks();
});

// ─── Device token management ──────────────────────────────────────────────────

describe('registerToken', () => {
  it('stores a valid ExponentPushToken', async () => {
    await registerToken(USER, TOKEN);
    const tokens = await getTokens(USER);
    expect(tokens).toContain(TOKEN);
  });

  it('stores a valid ExpoPushToken', async () => {
    const t = 'ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
    await registerToken(USER, t);
    expect(await getTokens(USER)).toContain(t);
  });

  it('rejects invalid token format', async () => {
    await expect(registerToken(USER, 'invalid-token')).rejects.toThrow('Invalid Expo push token');
  });
});

describe('removeToken', () => {
  it('removes a specific token', async () => {
    await registerToken(USER, TOKEN);
    await removeToken(USER, TOKEN);
    expect(await getTokens(USER)).not.toContain(TOKEN);
  });
});

describe('removeAllTokens', () => {
  it('removes all tokens for a user', async () => {
    await registerToken(USER, TOKEN);
    await registerToken(USER, 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]');
    await removeAllTokens(USER);
    expect(await getTokens(USER)).toHaveLength(0);
  });
});

// ─── Topic subscriptions ──────────────────────────────────────────────────────

describe('subscribe / unsubscribe', () => {
  it('subscribes to a valid topic', async () => {
    await subscribe(USER, TOPIC);
    expect(await isSubscribed(USER, TOPIC)).toBe(true);
  });

  it('unsubscribes from a topic', async () => {
    await subscribe(USER, TOPIC);
    await unsubscribe(USER, TOPIC);
    expect(await isSubscribed(USER, TOPIC)).toBe(false);
  });

  it('rejects unknown topic', async () => {
    await expect(subscribe(USER, 'unknown_topic' as any)).rejects.toThrow('Unknown topic');
  });

  it('returns all subscriptions', async () => {
    await subscribe(USER, 'medication_reminders');
    await subscribe(USER, 'appointment_alerts');
    const subs = await getSubscriptions(USER);
    expect(subs).toContain('medication_reminders');
    expect(subs).toContain('appointment_alerts');
  });
});

// ─── Preferences ──────────────────────────────────────────────────────────────

describe('preferences', () => {
  it('returns defaults when not set', async () => {
    const prefs = await getPreferences(USER);
    expect(prefs.enabled).toBe(true);
    expect(prefs.topics.medication_reminders).toBe(true);
  });

  it('persists preference updates', async () => {
    await setPreferences(USER, { enabled: false });
    const prefs = await getPreferences(USER);
    expect(prefs.enabled).toBe(false);
  });

  it('merges topic-level preferences', async () => {
    await setPreferences(USER, { topics: { health_tips: false } });
    const prefs = await getPreferences(USER);
    expect(prefs.topics.health_tips).toBe(false);
    expect(prefs.topics.medication_reminders).toBe(true); // unchanged
  });
});

// ─── Enqueue / idempotency ────────────────────────────────────────────────────

describe('enqueue', () => {
  it('enqueues a job when user is subscribed and prefs allow', async () => {
    await setupSubscribedUser();
    const queued = await enqueue(makeJob());
    expect(queued).toBe(true);
  });

  it('is idempotent — same jobId not enqueued twice', async () => {
    await setupSubscribedUser();
    const job = makeJob({ jobId: 'fixed-id' });
    const first = await enqueue(job);
    const second = await enqueue(job);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('skips when user is not subscribed to topic', async () => {
    await registerToken(USER, TOKEN);
    // Do NOT subscribe
    const queued = await enqueue(makeJob());
    expect(queued).toBe(false);
  });

  it('skips when push is globally disabled', async () => {
    await setupSubscribedUser();
    await setPreferences(USER, { enabled: false });
    const queued = await enqueue(makeJob());
    expect(queued).toBe(false);
  });

  it('skips when topic is disabled in preferences', async () => {
    await setupSubscribedUser();
    await setPreferences(USER, { topics: { medication_reminders: false } });
    const queued = await enqueue(makeJob());
    expect(queued).toBe(false);
  });
});

// ─── Delivery ─────────────────────────────────────────────────────────────────

describe('processOne', () => {
  it('delivers a notification successfully', async () => {
    await setupSubscribedUser();
    mockFetch.mockResolvedValueOnce(expoOkResponse());
    await enqueue(makeJob());
    const processed = await processOne();
    expect(processed).toBe(true);
    const metrics = await getMetrics();
    expect(metrics.delivered).toBe(1);
  });

  it('returns false when queue is empty', async () => {
    const processed = await processOne();
    expect(processed).toBe(false);
  });

  it('retries on transient failure', async () => {
    await setupSubscribedUser();
    mockFetch.mockResolvedValueOnce(expoHttpError(500));
    await enqueue(makeJob());
    await processOne();
    const metrics = await getMetrics();
    expect(metrics.retried).toBe(1);
    expect(metrics.delivered).toBe(0);
  });

  it('moves to DLQ after max attempts', async () => {
    await setupSubscribedUser();
    // All 3 attempts fail
    mockFetch
      .mockResolvedValueOnce(expoHttpError(500))
      .mockResolvedValueOnce(expoHttpError(500))
      .mockResolvedValueOnce(expoHttpError(500));

    await enqueue(makeJob({ jobId: 'dlq-test' }));
    // Process 3 times (each re-enqueues until max)
    await processOne(); // attempt 1 → retry
    await processOne(); // attempt 2 → retry
    await processOne(); // attempt 3 → DLQ

    const dlq = await getDLQ();
    expect(dlq.length).toBe(1);
    expect(dlq[0].jobId).toBe('dlq-test');
    const metrics = await getMetrics();
    expect(metrics.deadLettered).toBe(1);
    expect(metrics.failed).toBe(1);
  });

  it('removes invalid token on DeviceNotRegistered error', async () => {
    await setupSubscribedUser();
    mockFetch.mockResolvedValueOnce(expoErrorResponse('DeviceNotRegistered'));
    await enqueue(makeJob());
    await processOne();
    const tokens = await getTokens(USER);
    expect(tokens).not.toContain(TOKEN);
  });
});

// ─── drainQueue ───────────────────────────────────────────────────────────────

describe('drainQueue', () => {
  it('processes all queued jobs', async () => {
    await setupSubscribedUser();
    mockFetch.mockResolvedValue(expoOkResponse());

    for (let i = 0; i < 5; i++) {
      await enqueue(makeJob({ jobId: `job-${i}` }));
    }
    const processed = await drainQueue();
    expect(processed).toBe(5);
    const metrics = await getMetrics();
    expect(metrics.delivered).toBe(5);
  });
});

// ─── sendToUser ───────────────────────────────────────────────────────────────

describe('sendToUser', () => {
  it('enqueues one job per registered token', async () => {
    const t2 = 'ExponentPushToken[zzzzzzzzzzzzzzzzzzzzzz]';
    await registerToken(USER, TOKEN);
    await registerToken(USER, t2);
    await subscribe(USER, TOPIC);

    const count = await sendToUser(USER, TOPIC, 'Hello', 'World');
    expect(count).toBe(2);
  });

  it('returns 0 when user has no tokens', async () => {
    await subscribe(USER, TOPIC);
    const count = await sendToUser(USER, TOPIC, 'Hello', 'World');
    expect(count).toBe(0);
  });
});

// ─── DLQ management ──────────────────────────────────────────────────────────

describe('DLQ', () => {
  it('clearDLQ empties the dead-letter queue', async () => {
    await setupSubscribedUser();
    mockFetch.mockResolvedValue(expoHttpError(500));
    await enqueue(makeJob({ jobId: 'dlq-clear-test' }));
    await processOne();
    await processOne();
    await processOne();
    await clearDLQ();
    expect(await getDLQ()).toHaveLength(0);
  });
});

// ─── Metrics ──────────────────────────────────────────────────────────────────

describe('getMetrics', () => {
  it('returns zero metrics when nothing has happened', async () => {
    const m = await getMetrics();
    expect(m.queued).toBe(0);
    expect(m.delivered).toBe(0);
  });

  it('tracks queued and delivered counts', async () => {
    await setupSubscribedUser();
    mockFetch.mockResolvedValue(expoOkResponse());
    await enqueue(makeJob({ jobId: 'metrics-test' }));
    await processOne();
    const m = await getMetrics();
    expect(m.queued).toBe(1);
    expect(m.delivered).toBe(1);
  });
});

// ─── Load test: 1000 tokens ───────────────────────────────────────────────────

describe('load test — 1000 concurrent tokens', () => {
  it('enqueues and delivers 1000 notifications without errors', async () => {
    mockFetch.mockResolvedValue(expoOkResponse());

    // Register 1000 tokens across 10 users
    const users = Array.from({ length: 10 }, (_, i) => `load-user-${i}`);
    for (const uid of users) {
      await subscribe(uid, TOPIC);
      for (let t = 0; t < 100; t++) {
        const token = `ExponentPushToken[load${uid}${String(t).padStart(4, '0')}]`;
        await registerToken(uid, token);
      }
    }

    // Enqueue to all users
    let totalEnqueued = 0;
    for (const uid of users) {
      const count = await sendToUser(uid, TOPIC, 'Load Test', 'Body');
      totalEnqueued += count;
    }
    expect(totalEnqueued).toBe(1000);

    // Drain queue
    const processed = await drainQueue(1100);
    expect(processed).toBe(1000);

    const metrics = await getMetrics();
    expect(metrics.delivered).toBe(1000);
    expect(metrics.failed).toBe(0);
  }, 30000); // 30s timeout for load test
});
