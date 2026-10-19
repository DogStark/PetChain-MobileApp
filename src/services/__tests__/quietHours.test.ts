import {
  QuietHoursConfig,
  QuietHoursService,
  QuietHoursStorage,
  QuietHoursApi,
  NotificationScheduler,
  DeferralResult,
  QuietHoursError,
} from '../quietHours';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class InMemoryStorage implements QuietHoursStorage {
  private store = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }
  seed(key: string, value: string): void {
    this.store.set(key, value);
  }
  raw(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
}

interface FakeApiOptions {
  fetchConfig?: () => Promise<QuietHoursConfig | null>;
  saveConfig?: (config: QuietHoursConfig) => Promise<QuietHoursConfig>;
}

class FakeApi implements QuietHoursApi {
  fetchCalls = 0;
  saveCalls = 0;
  private opts: FakeApiOptions;
  constructor(opts: FakeApiOptions = {}) {
    this.opts = opts;
  }
  async fetchConfig(): Promise<QuietHoursConfig | null> {
    this.fetchCalls += 1;
    if (this.opts.fetchConfig) return this.opts.fetchConfig();
    return null;
  }
  async saveConfig(config: QuietHoursConfig): Promise<QuietHoursConfig> {
    this.saveCalls += 1;
    if (this.opts.saveConfig) return this.opts.saveConfig(config);
    return config;
  }
}

class FakeScheduler implements NotificationScheduler {
  scheduled: Array<{ id: string; at: Date }> = [];
  async schedule(id: string, at: Date): Promise<void> {
    this.scheduled.push({ id, at });
  }
}

const baseConfig = (overrides: Partial<QuietHoursConfig> = {}): QuietHoursConfig => ({
  enabled: true,
  startMinutes: 22 * 60, // 22:00
  endMinutes: 7 * 60, // 07:00
  timezone: 'America/New_York',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

describe('QuietHoursService - main flow', () => {
  it('configures quiet hours and defers a notification inside the window', async () => {
    const storage = new InMemoryStorage();
    const api = new FakeApi();
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    const config = baseConfig();
    await service.saveConfig(config);

    expect(api.saveCalls).toBe(1);
    // Persisted locally for offline use.
    expect(storage.raw('quietHours.config')).not.toBeNull();

    // 23:30 local time on a normal day -> inside 22:00-07:00 window.
    const now = new Date('2024-06-10T23:30:00-04:00');
    const result: DeferralResult = await service.evaluateNotification(
      'reminder-1',
      now,
    );

    expect(result.deferred).toBe(true);
    expect(result.nextEligibleAt).toBeInstanceOf(Date);
    // Next eligible should be 07:00 the following morning local time.
    expect(result.nextEligibleAt.toISOString()).toBe(
      new Date('2024-06-11T07:00:00-04:00').toISOString(),
    );
    expect(scheduler.scheduled).toHaveLength(1);
    expect(scheduler.scheduled[0].id).toBe('reminder-1');
  });

  it('delivers immediately when outside the quiet window', async () => {
    const storage = new InMemoryStorage();
    const api = new FakeApi();
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    await service.saveConfig(baseConfig());

    const now = new Date('2024-06-10T12:00:00-04:00');
    const result = await service.evaluateNotification('reminder-2', now);

    expect(result.deferred).toBe(false);
    expect(result.nextEligibleAt).toBeNull();
    expect(scheduler.scheduled).toHaveLength(0);
  });

  it('delivers immediately when quiet hours are disabled', async () => {
    const storage = new InMemoryStorage();
    const api = new FakeApi();
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    await service.saveConfig(baseConfig({ enabled: false }));

    const now = new Date('2024-06-10T23:30:00-04:00');
    const result = await service.evaluateNotification('reminder-3', now);

    expect(result.deferred).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Permission denial & stale server data
// ---------------------------------------------------------------------------

describe('QuietHoursService - permission denial and stale data', () => {
  it('surfaces a permission error when saving is denied', async () => {
    const storage = new InMemoryStorage();
    const api = new FakeApi({
      saveConfig: async () => {
        throw new QuietHoursError('permission-denied', 'not allowed');
      },
    });
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    await expect(service.saveConfig(baseConfig())).rejects.toMatchObject({
      code: 'permission-denied',
    });
    // Nothing should be persisted when the server denies the change.
    expect(storage.raw('quietHours.config')).toBeNull();
  });

  it('falls back to cached config when server data is stale', async () => {
    const storage = new InMemoryStorage();
    const cached = baseConfig({ startMinutes: 21 * 60, endMinutes: 6 * 60 });
    storage.seed('quietHours.config', JSON.stringify(cached));

    const api = new FakeApi({
      fetchConfig: async () => {
        throw new QuietHoursError('stale-data', 'server returned stale data');
      },
    });
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    const resolved = await service.getConfig();
    expect(resolved).toEqual(cached);

    // 21:30 should now be inside the cached window.
    const now = new Date('2024-06-10T21:30:00-04:00');
    const result = await service.evaluateNotification('reminder-4', now);
    expect(result.deferred).toBe(true);
  });

  it('returns null config when server is stale and no cache exists', async () => {
    const storage = new InMemoryStorage();
    const api = new FakeApi({
      fetchConfig: async () => {
        throw new QuietHoursError('stale-data', 'stale');
      },
    });
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    const resolved = await service.getConfig();
    expect(resolved).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Retry behavior
// ---------------------------------------------------------------------------

describe('QuietHoursService - retry behavior', () => {
  it('retries a transient fetch failure and succeeds', async () => {
    const storage = new InMemoryStorage();
    let attempts = 0;
    const api = new FakeApi({
      fetchConfig: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new QuietHoursError('network', 'temporary');
        }
        return baseConfig();
      },
    });
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({
      storage,
      api,
      scheduler,
      maxRetries: 3,
      retryDelayMs: 0,
    });

    const resolved = await service.getConfig();
    expect(attempts).toBe(3);
    expect(resolved).not.toBeNull();
    expect(resolved?.enabled).toBe(true);
  });

  it('gives up after max retries and uses cache', async () => {
    const storage = new InMemoryStorage();
    const cached = baseConfig({ enabled: false });
    storage.seed('quietHours.config', JSON.stringify(cached));

    let attempts = 0;
    const api = new FakeApi({
      fetchConfig: async () => {
        attempts += 1;
        throw new QuietHoursError('network', 'down');
      },
    });
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({
      storage,
      api,
      scheduler,
      maxRetries: 2,
      retryDelayMs: 0,
    });

    const resolved = await service.getConfig();
    expect(attempts).toBe(3); // initial + 2 retries
    expect(resolved).toEqual(cached);
  });
});

// ---------------------------------------------------------------------------
// Offline preservation of cached config
// ---------------------------------------------------------------------------

describe('QuietHoursService - offline behavior', () => {
  it('preserves cached config when offline and evaluates against it', async () => {
    const storage = new InMemoryStorage();
    const cached = baseConfig();
    storage.seed('quietHours.config', JSON.stringify(cached));

    const api = new FakeApi({
      fetchConfig: async () => {
        throw new QuietHoursError('offline', 'no connection');
      },
    });
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({
      storage,
      api,
      scheduler,
      maxRetries: 0,
    });

    const resolved = await service.getConfig();
    expect(resolved).toEqual(cached);

    const now = new Date('2024-06-10T23:00:00-04:00');
    const result = await service.evaluateNotification('reminder-5', now);
    expect(result.deferred).toBe(true);
  });

  it('does not overwrite cache when an offline save fails', async () => {
    const storage = new InMemoryStorage();
    const cached = baseConfig({ startMinutes: 20 * 60 });
    storage.seed('quietHours.config', JSON.stringify(cached));

    const api = new FakeApi({
      saveConfig: async () => {
        throw new QuietHoursError('offline', 'no connection');
      },
    });
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    await expect(
      service.saveConfig(baseConfig({ startMinutes: 23 * 60 })),
    ).rejects.toMatchObject({ code: 'offline' });

    expect(JSON.parse(storage.raw('quietHours.config') as string)).toEqual(
      cached,
    );
  });
});

// ---------------------------------------------------------------------------
// Timezone boundary cases
// ---------------------------------------------------------------------------

describe('QuietHoursService - timezone boundaries', () => {
  it('handles a window that crosses midnight', async () => {
    const storage = new InMemoryStorage();
    const api = new FakeApi();
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    await service.saveConfig(
      baseConfig({ startMinutes: 23 * 60, endMinutes: 2 * 60 }),
    );

    // 00:30 is inside 23:00-02:00.
    const inside = await service.evaluateNotification(
      'r-a',
      new Date('2024-06-11T00:30:00-04:00'),
    );
    expect(inside.deferred).toBe(true);
    expect(inside.nextEligibleAt?.toISOString()).toBe(
      new Date('2024-06-11T02:00:00-04:00').toISOString(),
    );

    // 03:00 is outside.
    const outside = await service.evaluateNotification(
      'r-b',
      new Date('2024-06-11T03:00:00-04:00'),
    );
    expect(outside.deferred).toBe(false);
  });

  it('computes next eligible time across a DST spring-forward shift', async () => {
    const storage = new InMemoryStorage();
    const api = new FakeApi();
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    // US DST spring-forward: 2024-03-10 02:00 -> 03:00 in America/New_York.
    await service.saveConfig(
      baseConfig({ startMinutes: 22 * 60, endMinutes: 7 * 60 }),
    );

    // 23:00 on 2024-03-09 (EST, -05:00) is inside the window.
    const now = new Date('2024-03-09T23:00:00-05:00');
    const result = await service.evaluateNotification('r-dst', now);

    expect(result.deferred).toBe(true);
    // Next eligible 07:00 on 2024-03-10 is EDT (-04:00) after the shift.
    expect(result.nextEligibleAt?.toISOString()).toBe(
      new Date('2024-03-10T07:00:00-04:00').toISOString(),
    );
  });

  it('computes next eligible time across a DST fall-back shift', async () => {
    const storage = new InMemoryStorage();
    const api = new FakeApi();
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    // US DST fall-back: 2024-11-03 02:00 -> 01:00 in America/New_York.
    await service.saveConfig(
      baseConfig({ startMinutes: 22 * 60, endMinutes: 7 * 60 }),
    );

    // 23:00 on 2024-11-02 (EDT, -04:00) is inside the window.
    const now = new Date('2024-11-02T23:00:00-04:00');
    const result = await service.evaluateNotification('r-dst2', now);

    expect(result.deferred).toBe(true);
    // Next eligible 07:00 on 2024-11-03 is EST (-05:00) after the shift.
    expect(result.nextEligibleAt?.toISOString()).toBe(
      new Date('2024-11-03T07:00:00-05:00').toISOString(),
    );
  });

  it('respects the configured timezone rather than device timezone', async () => {
    const storage = new InMemoryStorage();
    const api = new FakeApi();
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    await service.saveConfig(
      baseConfig({
        startMinutes: 22 * 60,
        endMinutes: 7 * 60,
        timezone: 'Asia/Tokyo',
      }),
    );

    // 23:00 Tokyo time (UTC+9) is inside the window.
    const now = new Date('2024-06-10T23:00:00+09:00');
    const result = await service.evaluateNotification('r-tz', now);

    expect(result.deferred).toBe(true);
    expect(result.nextEligibleAt?.toISOString()).toBe(
      new Date('2024-06-11T07:00:00+09:00').toISOString(),
    );
  });

  it('treats start == end as a full-day quiet window', async () => {
    const storage = new InMemoryStorage();
    const api = new FakeApi();
    const scheduler = new FakeScheduler();
    const service = new QuietHoursService({ storage, api, scheduler });

    await service.saveConfig(
      baseConfig({ startMinutes: 8 * 60, endMinutes: 8 * 60 }),
    );

    const result = await service.evaluateNotification(
      'r-full',
      new Date('2024-06-10T12:00:00-04:00'),
    );
    expect(result.deferred).toBe(true);
  });
});