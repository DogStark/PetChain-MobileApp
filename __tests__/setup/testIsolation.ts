/**
 * Test data isolation helpers for parallel Jest suites.
 *
 * Shared database and storage fixtures can make tests pass or fail depending
 * on execution order. These helpers give each suite an isolated namespace and
 * reset it deterministically, so suites pass in random order and in-band mode
 * without weakening production behavior.
 *
 * This module also provides a fake-clock lifecycle harness for app-lock
 * timeout policy tests. It tracks background duration with a monotonic clock
 * so wall-clock changes (manual clock changes, timezone/DST shifts) cannot
 * bypass the lock, and it re-locks sensitive screens on resume once the
 * configured timeout has elapsed.
 */

import { randomUUID } from 'crypto';

/**
 * A deterministic, per-suite namespace used to prefix database keys and
 * storage paths so fixtures never collide across suites or account ids.
 */
export type TestNamespace = {
  /** Unique namespace id for the current suite. */
  id: string;
  /** Prefix applied to every database key owned by this suite. */
  dbPrefix: string;
  /** Prefix applied to every storage path owned by this suite. */
  storagePrefix: string;
  /** Namespace a database key so it cannot leak across suites. */
  dbKey: (key: string) => string;
  /** Namespace a storage path so it cannot leak across suites. */
  storagePath: (path: string) => string;
};

/**
 * Create an isolated namespace for a suite. The id is derived from the suite
 * name plus a random suffix so parallel workers never share a namespace, while
 * still being readable in failure output.
 */
export function createTestNamespace(suiteName: string): TestNamespace {
  const slug = suiteName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'suite';
  const id = `${slug}-${randomUUID()}`;
  const dbPrefix = `test:${id}:`;
  const storagePrefix = `test/${id}/`;

  return {
    id,
    dbPrefix,
    storagePrefix,
    dbKey: (key: string) => `${dbPrefix}${key}`,
    storagePath: (path: string) => `${storagePrefix}${path.replace(/^\/+/, '')}`,
  };
}

/**
 * Minimal shape of the shared database fixture used by the suites. Only the
 * operations needed for isolation are required, so this stays compatible with
 * the existing in-memory and remote test doubles.
 */
export type IsolatableDatabase = {
  set: (key: string, value: unknown) => void | Promise<void>;
  get: (key: string) => unknown | Promise<unknown>;
  remove: (key: string) => void | Promise<void>;
  keys?: () => string[] | Promise<string[]>;
};

/**
 * Minimal shape of the shared storage fixture used by the suites.
 */
export type IsolatableStorage = {
  write: (path: string, value: unknown) => void | Promise<void>;
  read: (path: string) => unknown | Promise<unknown>;
  remove: (path: string) => void | Promise<void>;
  list?: () => string[] | Promise<string[]>;
};

/**
 * Track every key/path written through an isolated fixture so cleanup can
 * remove exactly what the suite created, even when a test fails mid-way.
 */
export type IsolationTracker = {
  namespace: TestNamespace;
  /** Record a database key written by the suite. */
  trackDbKey: (key: string) => void;
  /** Record a storage path written by the suite. */
  trackStoragePath: (path: string) => void;
  /** Remove all tracked fixtures. Safe to call multiple times. */
  cleanup: () => Promise<void>;
};

/**
 * Create a tracker bound to a namespace and the shared fixtures. Cleanup is
 * idempotent and swallows individual removal errors so a single failure cannot
 * prevent the rest of the teardown from running.
 */
export function createIsolationTracker(
  namespace: TestNamespace,
  db: IsolatableDatabase,
  storage: IsolatableStorage,
): IsolationTracker {
  const dbKeys = new Set<string>();
  const storagePaths = new Set<string>();

  return {
    namespace,
    trackDbKey: (key: string) => {
      dbKeys.add(key);
    },
    trackStoragePath: (path: string) => {
      storagePaths.add(path);
    },
    cleanup: async () => {
      const removals: Array<Promise<void>> = [];

      for (const key of dbKeys) {
        removals.push(Promise.resolve(db.remove(key)).then(() => undefined, () => undefined));
      }
      for (const path of storagePaths) {
        removals.push(Promise.resolve(storage.remove(path)).then(() => undefined, () => undefined));
      }

      await Promise.all(removals);
      dbKeys.clear();
      storagePaths.clear();
    },
  };
}

/**
 * Assert that no fixture data leaked across account ids. Any key or path that
 * belongs to another namespace is a leak and fails the suite.
 */
export async function assertNoFixtureLeak(
  namespace: TestNamespace,
  db: IsolatableDatabase,
  storage: IsolatableStorage,
): Promise<void> {
  if (typeof db.keys === 'function') {
    const keys = await db.keys();
    const leaked = keys.filter((key) => key.startsWith('test:') && !key.startsWith(namespace.dbPrefix));
    if (leaked.length > 0) {
      throw new Error(
        `Fixture leak detected in database for namespace ${namespace.id}: ${leaked.join(', ')}`,
      );
    }
  }

  if (typeof storage.list === 'function') {
    const paths = await storage.list();
    const leaked = paths.filter(
      (path) => path.startsWith('test/') && !path.startsWith(namespace.storagePrefix),
    );
    if (leaked.length > 0) {
      throw new Error(
        `Fixture leak detected in storage for namespace ${namespace.id}: ${leaked.join(', ')}`,
      );
    }
  }
}

/**
 * Wire up deterministic per-suite isolation. Returns the namespace and tracker
 * so suites can register cleanup in afterEach/afterAll, guaranteeing teardown
 * runs even when a test fails.
 */
export function setupTestIsolation(
  suiteName: string,
  db: IsolatableDatabase,
  storage: IsolatableStorage,
): { namespace: TestNamespace; tracker: IsolationTracker } {
  const namespace = createTestNamespace(suiteName);
  const tracker = createIsolationTracker(namespace, db, storage);
  return { namespace, tracker };
}

/**
 * Explicit app-lock timeout policy. The lock re-engages after the app has been
 * backgrounded for at least `timeoutMs` of monotonic elapsed time. Keeping the
 * threshold in one place makes the policy testable and consistent across
 * background, kill, and resume transitions.
 */
export type AppLockTimeoutPolicy = {
  /** Background duration (ms) after which the lock must re-engage. */
  timeoutMs: number;
};

export const DEFAULT_APP_LOCK_TIMEOUT_POLICY: AppLockTimeoutPolicy = {
  timeoutMs: 30_000,
};

/**
 * Monotonic clock source. `now()` must never move backwards and must not be
 * affected by wall-clock changes, so tests can advance it deterministically.
 */
export type MonotonicClock = {
  now: () => number;
};

/**
 * A controllable monotonic clock for fake-clock lifecycle tests. `advance`
 * moves time forward only; `setWallClock` simulates a manual clock change or
 * timezone/DST shift without touching monotonic time.
 */
export type FakeClock = MonotonicClock & {
  /** Advance monotonic time by `ms` (must be >= 0). */
  advance: (ms: number) => void;
  /** Simulate a wall-clock change; must not affect monotonic time. */
  setWallClock: (epochMs: number) => void;
  /** Current simulated wall-clock time (for assertions only). */
  wallClock: () => number;
};

/**
 * Create a fake monotonic clock seeded at `startMs`. Wall-clock changes are
 * tracked separately so tests can prove they do not bypass the lock.
 */
export function createFakeClock(startMs = 0): FakeClock {
  let monotonic = startMs;
  let wall = startMs;

  return {
    now: () => monotonic,
    advance: (ms: number) => {
      if (ms < 0) {
        throw new Error('FakeClock.advance requires a non-negative duration');
      }
      monotonic += ms;
      wall += ms;
    },
    setWallClock: (epochMs: number) => {
      wall = epochMs;
    },
    wallClock: () => wall,
  };
}

/**
 * Sensitive screens that must be re-locked on resume once the timeout elapses.
 */
export const SENSITIVE_SCREENS = [
  'Wallet',
  'Settings',
  'Keychain',
  'Transactions',
] as const;

export type SensitiveScreen = (typeof SENSITIVE_SCREENS)[number];

export type AppLockState = {
  /** Whether the lock is currently engaged. */
  locked: boolean;
  /** Screen that was active when the app was backgrounded. */
  screen: SensitiveScreen;
};

/**
 * Minimal app-lock lifecycle harness used by the timeout policy tests. It
 * records the monotonic timestamp at background time and re-locks on resume
 * when the elapsed monotonic duration meets or exceeds the policy timeout.
 */
export type AppLockLifecycle = {
  /** Current lock state. */
  state: () => AppLockState;
  /** Record backgrounding of a sensitive screen. */
  background: (screen: SensitiveScreen) => void;
  /** Resume the app; returns true when the lock re-engaged. */
  resume: () => boolean;
  /** Unlock the app (e.g. after successful auth). */
  unlock: () => void;
};

/**
 * Create an app-lock lifecycle harness bound to a monotonic clock and policy.
 * Background duration is measured with the monotonic clock only, so wall-clock
 * changes cannot bypass the lock.
 */
export function createAppLockLifecycle(
  clock: MonotonicClock,
  policy: AppLockTimeoutPolicy = DEFAULT_APP_LOCK_TIMEOUT_POLICY,
): AppLockLifecycle {
  let locked = false;
  let screen: SensitiveScreen = 'Wallet';
  let backgroundedAt: number | null = null;

  return {
    state: () => ({ locked, screen }),
    background: (nextScreen: SensitiveScreen) => {
      screen = nextScreen;
      backgroundedAt = clock.now();
    },
    resume: () => {
      if (backgroundedAt === null) {
        return locked;
      }
      const elapsed = clock.now() - backgroundedAt;
      backgroundedAt = null;
      if (elapsed >= policy.timeoutMs) {
        locked = true;
      }
      return locked;
    },
    unlock: () => {
      locked = false;
    },
  };
}
