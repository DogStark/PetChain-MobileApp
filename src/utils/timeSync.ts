/**
 * Deterministic server clock reconciliation for safety-sensitive reminders.
 *
 * Reminders and expiration checks must not trust the raw device clock, since
 * device clock manipulation can make them fire early or late. Instead we
 * reconcile against server time when it is available and clamp the resulting
 * offset to a bounded range.
 *
 * Offline behavior:
 * When no server time is available (offline, request failure, or a malformed
 * response) we fall back to the device clock with a zero offset. In that case
 * `uncertain` is true so callers can surface the uncertainty for
 * safety-sensitive reminders instead of silently scheduling unsafe actions.
 */

/** Maximum absolute offset (ms) we are willing to trust from server time. */
export const MAX_CLOCK_OFFSET_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Offset magnitude (ms) above which the skew is considered large enough to
 * warn the user about. Kept below MAX_CLOCK_OFFSET_MS so a clamped-but-large
 * skew is still surfaced.
 */
export const LARGE_CLOCK_SKEW_MS = 60 * 1000; // 1 minute

export interface ClockReconciliation {
  /** Bounded offset (ms) to add to the device clock to approximate server time. */
  offsetMs: number;
  /** True when the offset was clamped to MAX_CLOCK_OFFSET_MS. */
  clamped: boolean;
  /** True when the skew is large enough to warn the user about. */
  largeSkew: boolean;
  /** True when no trustworthy server time was available (offline fallback). */
  uncertain: boolean;
  /** Server time used for reconciliation, or null when unavailable. */
  serverTimeMs: number | null;
}

/**
 * Clamp an offset to the bounded range we are willing to trust.
 */
export function clampClockOffset(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) {
    return 0;
  }
  if (offsetMs > MAX_CLOCK_OFFSET_MS) {
    return MAX_CLOCK_OFFSET_MS;
  }
  if (offsetMs < -MAX_CLOCK_OFFSET_MS) {
    return -MAX_CLOCK_OFFSET_MS;
  }
  return offsetMs;
}

/**
 * Reconcile the device clock against a server timestamp.
 *
 * @param serverTimeMs Server time in epoch ms, or null/undefined when offline.
 * @param deviceTimeMs Device time in epoch ms (defaults to Date.now()).
 */
export function reconcileClock(
  serverTimeMs: number | null | undefined,
  deviceTimeMs: number = Date.now(),
): ClockReconciliation {
  if (serverTimeMs == null || !Number.isFinite(serverTimeMs)) {
    return {
      offsetMs: 0,
      clamped: false,
      largeSkew: false,
      uncertain: true,
      serverTimeMs: null,
    };
  }

  const rawOffset = serverTimeMs - deviceTimeMs;
  const offsetMs = clampClockOffset(rawOffset);
  const clamped = offsetMs !== rawOffset;

  return {
    offsetMs,
    clamped,
    largeSkew: Math.abs(offsetMs) >= LARGE_CLOCK_SKEW_MS,
    uncertain: clamped,
    serverTimeMs,
  };
}

/**
 * Apply a reconciled offset to a device timestamp.
 */
export function applyClockOffset(
  deviceTimeMs: number,
  offsetMs: number,
): number {
  return deviceTimeMs + clampClockOffset(offsetMs);
}

/**
 * Compute the reconciled "now" for reminder/expiration calculations.
 *
 * When reconciliation is uncertain (offline or clamped skew) the caller is
 * expected to surface that uncertainty for safety-sensitive reminders rather
 * than silently scheduling unsafe actions.
 */
export function reconciledNow(
  reconciliation: ClockReconciliation,
  deviceTimeMs: number = Date.now(),
): number {
  return applyClockOffset(deviceTimeMs, reconciliation.offsetMs);
}

/**
 * Whether a reminder/expiration action should be blocked because the clock is
 * not trustworthy enough to schedule it safely.
 */
export function isClockUnsafeForReminders(
  reconciliation: ClockReconciliation,
): boolean {
  return reconciliation.uncertain || reconciliation.clamped;
}
