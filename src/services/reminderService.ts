import * as Notifications from 'expo-notifications';

export type SnoozeDuration = 15 | 60 | 120 | number;

export interface SnoozeRecord {
  reminderId: string;
  snoozedAt: number;
  durationMinutes: number;
}

/**
 * Maximum clock offset (in ms) we are willing to trust from the server.
 * Anything larger is treated as unsafe skew: we clamp to this bound and
 * surface the uncertainty instead of silently scheduling reminders.
 */
export const MAX_TRUSTED_CLOCK_OFFSET_MS = 5 * 60 * 1000;

/**
 * Offline fallback: when no server time is available we assume zero offset
 * (device clock) but mark the result as unverified so callers can warn the
 * user before scheduling safety-sensitive reminders.
 */
export interface ClockReconciliation {
  /** Bounded offset (ms) to add to device time to approximate server time. */
  offsetMs: number;
  /** True when the offset came from a server response. */
  verified: boolean;
  /** True when the raw server offset exceeded MAX_TRUSTED_CLOCK_OFFSET_MS. */
  skewed: boolean;
}

let cachedReconciliation: ClockReconciliation | null = null;

function clampOffset(offsetMs: number): number {
  if (offsetMs > MAX_TRUSTED_CLOCK_OFFSET_MS) return MAX_TRUSTED_CLOCK_OFFSET_MS;
  if (offsetMs < -MAX_TRUSTED_CLOCK_OFFSET_MS) return -MAX_TRUSTED_CLOCK_OFFSET_MS;
  return offsetMs;
}

/**
 * Reconcile the device clock against server time.
 *
 * - Uses the server `Date` header when available and derives a bounded offset.
 * - Falls back safely offline: offset 0, `verified: false`.
 * - Flags large skew via `skewed: true` so callers can surface uncertainty.
 */
export async function reconcileClock(): Promise<ClockReconciliation> {
  try {
    const res = await fetch('/api/time', { method: 'HEAD' });
    const serverDate = res.headers.get('date');
    if (!serverDate) {
      cachedReconciliation = { offsetMs: 0, verified: false, skewed: false };
      return cachedReconciliation;
    }

    const serverMs = new Date(serverDate).getTime();
    if (Number.isNaN(serverMs)) {
      cachedReconciliation = { offsetMs: 0, verified: false, skewed: false };
      return cachedReconciliation;
    }

    const rawOffset = serverMs - Date.now();
    const skewed = Math.abs(rawOffset) > MAX_TRUSTED_CLOCK_OFFSET_MS;
    cachedReconciliation = {
      offsetMs: clampOffset(rawOffset),
      verified: true,
      skewed,
    };
    return cachedReconciliation;
  } catch {
    // Offline / network failure: safe fallback to device clock, unverified.
    cachedReconciliation = { offsetMs: 0, verified: false, skewed: false };
    return cachedReconciliation;
  }
}

/**
 * Current time adjusted by the last reconciled (bounded) offset.
 * Falls back to device time when no reconciliation has run yet.
 */
export function reconciledNow(): number {
  return Date.now() + (cachedReconciliation?.offsetMs ?? 0);
}

export const reminderService = {
  async snooze(
    reminderId: string,
    durationMinutes: SnoozeDuration,
    nextDoseWindowMs?: number,
  ): Promise<Date> {
    const clock = cachedReconciliation ?? (await reconcileClock());

    // Safety: refuse to silently schedule when the clock is unverified or skewed.
    if (clock.skewed) {
      throw new Error(
        'Device clock is significantly out of sync with the server; reminder not scheduled',
      );
    }

    const snoozeUntil = new Date(reconciledNow() + durationMinutes * 60 * 1000);

    if (nextDoseWindowMs && snoozeUntil.getTime() > nextDoseWindowMs) {
      throw new Error('Cannot snooze past next dose window');
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Medication Reminder',
        body: clock.verified
          ? 'Time to take your medication'
          : 'Time to take your medication (device clock unverified)',
        data: { reminderId, snoozed: true, clockVerified: clock.verified },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: snoozeUntil },
    });

    await fetch('/api/reminders/snooze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reminderId,
        durationMinutes,
        snoozeUntil: snoozeUntil.toISOString(),
        clockVerified: clock.verified,
      }),
    });

    return snoozeUntil;
  },

  async getSuggestedTime(reminderId: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/reminders/${reminderId}/suggested-time`);
      if (!res.ok) return null;

      const { suggestedHour } = (await res.json()) as { suggestedHour?: number | null };
      return typeof suggestedHour === 'number'
        ? `${String(suggestedHour).padStart(2, '0')}:00`
        : null;
    } catch {
      return null;
    }
  },
};
