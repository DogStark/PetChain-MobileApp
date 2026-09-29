import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Deterministic server clock reconciliation for safety-sensitive reminders.
 *
 * Device clock manipulation can cause medication reminders or expiration
 * checks to fire early or late. We reconcile against server time when it is
 * available and fall back safely when offline.
 *
 * Offline behavior: when no server time is available we keep the last known
 * bounded offset (or zero if we never synced). Reminders still run against the
 * device clock, but `isUncertain` is true so callers can surface uncertainty
 * and avoid silently scheduling unsafe actions.
 */

/** Maximum offset we trust. Larger skew is clamped and flagged as unsafe. */
export const MAX_TRUSTED_OFFSET_MS = 5 * 60 * 1000; // 5 minutes

/** How long a server sync stays fresh before we consider it stale. */
export const SYNC_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface ServerClockState {
  /** Bounded offset (serverTime - deviceTime) in ms, clamped to MAX_TRUSTED_OFFSET_MS. */
  offsetMs: number;
  /** True when the raw skew exceeded the trusted bound and was clamped. */
  hasLargeSkew: boolean;
  /** True when we have no fresh server time (offline or stale sync). */
  isUncertain: boolean;
  /** Timestamp (device clock) of the last successful server sync, or null. */
  lastSyncedAt: number | null;
}

/**
 * Clamp a raw offset to the trusted bound and report whether it was clamped.
 * Exported for deterministic unit testing with fake clocks.
 */
export function boundOffset(rawOffsetMs: number): { offsetMs: number; hasLargeSkew: boolean } {
  if (!Number.isFinite(rawOffsetMs)) {
    return { offsetMs: 0, hasLargeSkew: true };
  }
  if (rawOffsetMs > MAX_TRUSTED_OFFSET_MS) {
    return { offsetMs: MAX_TRUSTED_OFFSET_MS, hasLargeSkew: true };
  }
  if (rawOffsetMs < -MAX_TRUSTED_OFFSET_MS) {
    return { offsetMs: -MAX_TRUSTED_OFFSET_MS, hasLargeSkew: true };
  }
  return { offsetMs: rawOffsetMs, hasLargeSkew: false };
}

/**
 * Compute the reconciled "now" for reminder/expiration calculations.
 * Always applies the bounded offset so calculations are deterministic.
 */
export function reconciledNow(offsetMs: number, deviceNow: number = Date.now()): number {
  return deviceNow + offsetMs;
}

/**
 * Fetch server time. Returns the server epoch in ms, or null when unavailable.
 * Callers may inject a fetcher for testing.
 */
export type ServerTimeFetcher = () => Promise<number | null>;

const defaultFetcher: ServerTimeFetcher = async () => {
  try {
    const res = await fetch('/api/time', { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { epochMs?: number };
    return typeof data.epochMs === 'number' ? data.epochMs : null;
  } catch {
    return null;
  }
};

export interface UseServerClockOptions {
  fetcher?: ServerTimeFetcher;
  /** Auto-sync interval in ms. Set to 0 to disable periodic sync. */
  syncIntervalMs?: number;
}

export interface UseServerClockResult extends ServerClockState {
  /** Force a reconciliation attempt against server time. */
  sync: () => Promise<void>;
  /** Reconciled now (device time + bounded offset). */
  now: () => number;
}

/**
 * React hook that reconciles the device clock against server time.
 *
 * Reminder calculations should use `now()` (or `reconciledNow(offsetMs)`) so
 * they are bounded and deterministic. When `isUncertain` is true, callers must
 * surface uncertainty and must not silently schedule unsafe actions.
 */
export function useServerClock(options: UseServerClockOptions = {}): UseServerClockResult {
  const { fetcher = defaultFetcher, syncIntervalMs = SYNC_TTL_MS } = options;

  const [state, setState] = useState<ServerClockState>({
    offsetMs: 0,
    hasLargeSkew: false,
    isUncertain: true,
    lastSyncedAt: null,
  });

  const mountedRef = useRef(true);

  const sync = useCallback(async () => {
    const deviceBefore = Date.now();
    const serverTime = await fetcher();
    if (!mountedRef.current) return;

    if (serverTime === null || !Number.isFinite(serverTime)) {
      // Offline / unavailable: keep last bounded offset, mark uncertain.
      setState((prev) => ({ ...prev, isUncertain: true }));
      return;
    }

    const deviceAfter = Date.now();
    // Account for round-trip latency by using the midpoint of the request.
    const deviceMid = deviceBefore + (deviceAfter - deviceBefore) / 2;
    const { offsetMs, hasLargeSkew } = boundOffset(serverTime - deviceMid);

    setState({
      offsetMs,
      hasLargeSkew,
      isUncertain: false,
      lastSyncedAt: deviceAfter,
    });
  }, [fetcher]);

  useEffect(() => {
    mountedRef.current = true;
    void sync();

    if (syncIntervalMs > 0) {
      const id = setInterval(() => {
        void sync();
      }, syncIntervalMs);
      return () => {
        mountedRef.current = false;
        clearInterval(id);
      };
    }

    return () => {
      mountedRef.current = false;
    };
  }, [sync, syncIntervalMs]);

  const now = useCallback(() => reconciledNow(state.offsetMs), [state.offsetMs]);

  return { ...state, sync, now };
}
