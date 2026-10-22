import apiClient from './apiClient';

export type EventType = 'screen_view' | 'feature_usage' | 'error' | 'custom';

export interface AnalyticsEvent {
  type: EventType;
  name: string;
  meta?: Record<string, unknown>;
  timestamp: number;
}

/** Non-PII user attributes attached to batched events (e.g. plan tier, locale). */
export type UserProperties = Record<string, string | number | boolean>;

// ─── Batching config ──────────────────────────────────────────────────────────

/** Flush automatically once this many events are queued. */
const BATCH_SIZE = 20;
/** Or flush after this long, whichever comes first. */
const FLUSH_INTERVAL_MS = 30_000;
const BATCH_ENDPOINT = '/analytics/events';

// ─── Privacy: PII scrubbing (no personally-identifiable data leaves the device) ─

/**
 * Property keys that must never be sent to analytics. Matching is
 * case-insensitive and substring-based so `userEmail`, `ownerPhone`, etc. are
 * all caught.
 */
const PII_KEY_PATTERNS = [
  'email',
  'phone',
  'password',
  'token',
  'secret',
  'address',
  'name',
  'ssn',
  'dob',
  'birth',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'ip',
  'location',
  'card',
];

const isPiiKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  return PII_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
};

/**
 * Remove any property whose key looks like PII. Returns `undefined` when there
 * is nothing safe left to send, so empty objects are not transmitted.
 */
const scrubPii = <T extends Record<string, unknown>>(
  meta?: T,
): Record<string, unknown> | undefined => {
  if (!meta) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (isPiiKey(key)) continue;
    safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
};

// ─── Queue state ──────────────────────────────────────────────────────────────

let queue: AnalyticsEvent[] = [];
let userProperties: UserProperties = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleFlush = (): void => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
};

/**
 * Send all queued events to the backend in a single batch. Best-effort: on
 * failure the events are re-queued so nothing is silently dropped.
 */
export async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;

  const batch = queue;
  queue = [];

  try {
    await apiClient.post(BATCH_ENDPOINT, {
      events: batch,
      userProperties,
    });
  } catch {
    // Re-queue so events survive transient failures; never throw to callers.
    queue = batch.concat(queue);
    scheduleFlush();
  }
}

const enqueue = (type: EventType, name: string, meta?: Record<string, unknown>): void => {
  queue.push({ type, name, meta: scrubPii(meta), timestamp: Date.now() });
  if (queue.length >= BATCH_SIZE) {
    void flush();
  } else {
    scheduleFlush();
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────

/** Track an arbitrary custom event with optional (PII-free) properties. */
export const trackEvent = (name: string, properties?: Record<string, unknown>): void =>
  enqueue('custom', name, properties);

/** Track a screen/route view. */
export const trackScreenView = (screenName: string, properties?: Record<string, unknown>): void =>
  enqueue('screen_view', screenName, properties);

/** Track a handled/unhandled error event. */
export const trackError = (error: unknown, properties?: Record<string, unknown>): void => {
  const message = error instanceof Error ? error.message : String(error);
  enqueue('error', message, properties);
};

/**
 * Merge non-PII attributes onto the current user. PII keys are stripped before
 * storage so they can never be attached to future batches.
 */
export const setUserProperties = (properties: UserProperties): void => {
  const safe = scrubPii(properties) as UserProperties | undefined;
  if (safe) {
    userProperties = { ...userProperties, ...safe };
  }
};

/** Clear all in-memory user properties (e.g. on logout). */
export const resetUserProperties = (): void => {
  userProperties = {};
};

/**
 * Backwards-compatible object API. Existing callers use
 * `analyticsService.screenView` / `.featureUsed` / `.error`; the newer
 * `track*` helpers are exposed here too for convenience.
 */
export const analyticsService = {
  screenView: (screenName: string, meta?: Record<string, unknown>) =>
    trackScreenView(screenName, meta),
  featureUsed: (featureName: string, meta?: Record<string, unknown>) =>
    enqueue('feature_usage', featureName, meta),
  error: (errorMessage: string, meta?: Record<string, unknown>) =>
    enqueue('error', errorMessage, meta),
  trackEvent,
  trackScreenView,
  trackError,
  setUserProperties,
  resetUserProperties,
  flush,
};

export default analyticsService;
