import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Medication reminder hook with device-clock tamper handling.
 *
 * The device clock is treated as untrusted. We compare it against a trusted
 * server/ledger time when available, detect large forward/backward jumps on
 * app resume and during reminder/dose-log flows, and refuse to silently record
 * future or duplicate doses caused by a clock jump.
 */

// A jump larger than this (ms) between two observations is treated as tampering.
const CLOCK_JUMP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// How long a trusted server time sample is considered fresh.
const TRUSTED_TIME_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

// A dose scheduled further than this into the future is never auto-recorded.
const FUTURE_DOSE_TOLERANCE_MS = 60 * 1000; // 1 minute

export type ClockTrustState = 'trusted' | 'untrusted';

export interface ClockStatus {
  state: ClockTrustState;
  /** Human-readable, actionable reason when the clock is untrusted. */
  reason: string | null;
  /** Offset (device - server) in ms when a trusted sample is available. */
  offsetMs: number | null;
  /** True when the last detected change was a forward jump. */
  forwardJump: boolean;
  /** True when the last detected change was a backward jump. */
  backwardJump: boolean;
  /** True when a timezone/DST change was detected. */
  timezoneChanged: boolean;
}

export interface MedicationSchedule {
  id: string;
  medicationName: string;
  /** Scheduled dose time as an ISO-8601 string (server/ledger authoritative). */
  scheduledAt: string;
}

/**
 * Per-account quiet hours configuration. Times are local wall-clock minutes
 * since midnight (0-1439) in the account's timezone. A window may wrap
 * midnight (e.g. start 1320 / end 420 for 22:00-07:00).
 */
export interface QuietHoursConfig {
  enabled: boolean;
  /** Minutes since local midnight when quiet hours begin (inclusive). */
  startMinutes: number;
  /** Minutes since local midnight when quiet hours end (exclusive). */
  endMinutes: number;
}

export interface DeferredSchedule {
  schedule: MedicationSchedule;
  /** ISO-8601 time of the next eligible delivery after quiet hours end. */
  nextEligibleAt: string;
}

export interface QuietHoursStatus {
  /** True when the schedule is currently inside an active quiet window. */
  active: boolean;
  /** Human-readable explanation of why a notification was deferred. */
  reason: string | null;
  /** ISO-8601 time of the next eligible delivery, or null when not deferred. */
  nextEligibleAt: string | null;
}

export interface DoseLogEntry {
  scheduleId: string;
  /** Server/ledger timestamp when the dose was recorded, if known. */
  recordedAt: string;
}

export interface UseMedicationRemindersOptions {
  schedules: MedicationSchedule[];
  doseLogs: DoseLogEntry[];
  /** Per-account quiet hours; notifications inside the window are deferred. */
  quietHours?: QuietHoursConfig;
  /**
   * Returns trusted server/ledger time in ms, or null when offline/unavailable.
   * Server timestamps remain authoritative during reconciliation.
   */
  getTrustedTime?: () => Promise<number | null>;
  /** Persists a dose log entry. Only called for trusted, non-duplicate doses. */
  onRecordDose?: (entry: DoseLogEntry) => Promise<void> | void;
}

const INITIAL_STATUS: ClockStatus = {
  state: 'trusted',
  reason: null,
  offsetMs: null,
  forwardJump: false,
  backwardJump: false,
  timezoneChanged: false,
};

function getTimezoneOffset(): number {
  return new Date().getTimezoneOffset();
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function isWithinQuietHours(minutes: number, config: QuietHoursConfig): boolean {
  const { startMinutes, endMinutes } = config;
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return minutes >= startMinutes && minutes < endMinutes;
  }
  // Window wraps midnight.
  return minutes >= startMinutes || minutes < endMinutes;
}

/**
 * Compute the next eligible delivery time (local wall clock) after quiet hours
 * end, starting from the given instant. Handles windows that wrap midnight and
 * is recomputed against the current timezone offset on each call.
 */
function computeNextEligibleAt(from: Date, config: QuietHoursConfig): Date {
  const result = new Date(from.getTime());
  const minutes = minutesSinceMidnight(result);
  if (!isWithinQuietHours(minutes, config)) {
    return result;
  }

  const { startMinutes, endMinutes } = config;
  let minutesUntilEnd: number;
  if (startMinutes < endMinutes) {
    minutesUntilEnd = endMinutes - minutes;
  } else if (minutes >= startMinutes) {
    // Before midnight portion of a wrapping window.
    minutesUntilEnd = 24 * 60 - minutes + endMinutes;
  } else {
    // After midnight portion of a wrapping window.
    minutesUntilEnd = endMinutes - minutes;
  }

  result.setMinutes(result.getMinutes() + minutesUntilEnd);
  // Zero out seconds/ms so the eligible time is a clean boundary.
  result.setSeconds(0, 0);
  return result;
}

export function useMedicationReminders({
  schedules,
  doseLogs,
  quietHours,
  getTrustedTime,
  onRecordDose,
}: UseMedicationRemindersOptions) {
  const [clockStatus, setClockStatus] = useState<ClockStatus>(INITIAL_STATUS);
  const [quietHoursStatus, setQuietHoursStatus] = useState<QuietHoursStatus>({
    active: false,
    reason: null,
    nextEligibleAt: null,
  });

  // Last observed device time and timezone offset, used to detect jumps.
  const lastDeviceTimeRef = useRef<number | null>(null);
  const lastTimezoneOffsetRef = useRef<number | null>(null);
  const trustedSampleRef = useRef<{ serverMs: number; deviceMs: number } | null>(null);

  /**
   * Reconcile the device clock against trusted server/ledger time and detect
   * forward/backward jumps, timezone changes, and DST transitions.
   */
  const checkClock = useCallback(async (): Promise<ClockStatus> => {
    const deviceMs = Date.now();
    const tzOffset = getTimezoneOffset();

    let forwardJump = false;
    let backwardJump = false;
    let timezoneChanged = false;

    const previousDeviceMs = lastDeviceTimeRef.current;
    const previousTzOffset = lastTimezoneOffsetRef.current;

    if (previousDeviceMs !== null) {
      const delta = deviceMs - previousDeviceMs;
      if (delta > CLOCK_JUMP_THRESHOLD_MS) {
        forwardJump = true;
      } else if (delta < -CLOCK_JUMP_THRESHOLD_MS) {
        backwardJump = true;
      }
    }

    if (previousTzOffset !== null && previousTzOffset !== tzOffset) {
      timezoneChanged = true;
    }

    // Detect a DST transition: the wall-clock day is the same but the offset
    // shifted, which is the signature of a DST boundary crossing.
    if (previousDeviceMs !== null && previousTzOffset !== null && previousTzOffset !== tzOffset) {
      const prevDate = new Date(previousDeviceMs);
      const nowDate = new Date(deviceMs);
      if (isSameDay(prevDate, nowDate)) {
        timezoneChanged = true;
      }
    }

    lastDeviceTimeRef.current = deviceMs;
    lastTimezoneOffsetRef.current = tzOffset;

    let offsetMs: number | null = null;
    let trusted = true;
    let reason: string | null = null;

    if (getTrustedTime) {
      try {
        const serverMs = await getTrustedTime();
        if (serverMs !== null && Number.isFinite(serverMs)) {
          trustedSampleRef.current = { serverMs, deviceMs };
          offsetMs = deviceMs - serverMs;
          if (Math.abs(offsetMs) > CLOCK_JUMP_THRESHOLD_MS) {
            trusted = false;
            reason =
              'Your device clock does not match our records. Reminders and dose logging are paused until the clock is corrected.';
          }
        }
      } catch {
        // Offline or server unavailable: fall back to local jump detection only.
      }
    }

    if (forwardJump) {
      trusted = false;
      reason =
        'Your device clock jumped forward. To avoid recording a future dose, dose logging is paused until the clock is corrected.';
    } else if (backwardJump) {
      trusted = false;
      reason =
        'Your device clock jumped backward. To avoid duplicating a dose, dose logging is paused until the clock is corrected.';
    } else if (timezoneChanged && trusted) {
      reason =
        'Your timezone changed. Reminder times may shift; schedules remain viewable offline.';
    }

    const nextStatus: ClockStatus = {
      state: trusted ? 'trusted' : 'untrusted',
      reason,
      offsetMs,
      forwardJump,
      backwardJump,
      timezoneChanged,
    };

    setClockStatus(nextStatus);
    return nextStatus;
  }, [getTrustedTime]);

  /**
   * Recompute quiet-hours state against the current time and timezone. Called
   * whenever the clock is re-checked so timezone/DST changes are reflected.
   */
  const refreshQuietHours = useCallback((): QuietHoursStatus => {
    if (!quietHours || !quietHours.enabled) {
      const inactive: QuietHoursStatus = {
        active: false,
        reason: null,
        nextEligibleAt: null,
      };
      setQuietHoursStatus(inactive);
      return inactive;
    }

    const now = new Date();
    const active = isWithinQuietHours(minutesSinceMidnight(now), quietHours);
    const nextStatus: QuietHoursStatus = active
      ? {
          active: true,
          reason:
            'Care reminders are paused during your quiet hours. Notifications will be delivered at the next eligible time.',
          nextEligibleAt: computeNextEligibleAt(now, quietHours).toISOString(),
        }
      : { active: false, reason: null, nextEligibleAt: null };

    setQuietHoursStatus(nextStatus);
    return nextStatus;
  }, [quietHours]);

  // Detect clock changes on app resume.
  useEffect(() => {
    const handleResume = () => {
      void checkClock().then(() => {
        refreshQuietHours();
      });
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleResume);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleResume);
    }

    void checkClock().then(() => {
      refreshQuietHours();
    });

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleResume);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleResume);
      }
    };
  }, [checkClock, refreshQuietHours]);

  // Recompute quiet hours whenever the configuration changes.
  useEffect(() => {
    refreshQuietHours();
  }, [refreshQuietHours]);

  // Recompute quiet hours when a timezone change is detected.
  useEffect(() => {
    if (clockStatus.timezoneChanged) {
      refreshQuietHours();
    }
  }, [clockStatus.timezoneChanged, refreshQuietHours]);

  /**
   * Record a dose. Refuses to silently record a future dose or duplicate a dose
   * caused by a clock jump. Server timestamps remain authoritative.
   */
  const recordDose = useCallback(
    async (scheduleId: string): Promise<{ recorded: boolean; reason?: string }> => {
      const status = await checkClock();

      if (status.state === 'untrusted') {
        return {
          recorded: false,
          reason:
            status.reason ??
            'Your device clock is unreliable right now. Dose logging is paused until it is corrected.',
        };
      }

      const schedule = schedules.find((s) => s.id === scheduleId);
      if (!schedule) {
        return { recorded: false, reason: 'Unknown medication schedule.' };
      }

      // Use trusted server time when available; otherwise fall back to device time.
      const trustedSample = trustedSampleRef.current;
      const nowMs = trustedSample ? trustedSample.serverMs : Date.now();
      const scheduledMs = Date.parse(schedule.scheduledAt);

      if (Number.isFinite(scheduledMs) && scheduledMs - nowMs > FUTURE_DOSE_TOLERANCE_MS) {
        return {
          recorded: false,
          reason: 'This dose is scheduled in the future and cannot be recorded yet.',
        };
      }

      // Guard against duplicates caused by a clock jump: a dose already logged
      // for this schedule on the same trusted day is not recorded again.
      const alreadyLogged = doseLogs.some((log) => {
        if (log.scheduleId !== scheduleId) return false;
        const loggedMs = Date.parse(log.recordedAt);
        if (!Number.isFinite(loggedMs)) return false;
        return isSameDay(new Date(loggedMs), new Date(nowMs));
      });

      if (alreadyLogged) {
        return { recorded: false, reason: 'This dose has already been recorded today.' };
      }

      const entry: DoseLogEntry = {
        scheduleId,
        recordedAt: new Date(nowMs).toISOString(),
      };

      if (onRecordDose) {
        await onRecordDose(entry);
      }

      return { recorded: true };
    },
    [checkClock, schedules, doseLogs, onRecordDose],
  );

  /**
   * Schedules remain viewable offline even while the clock is untrusted.
   */
  const visibleSchedules = schedules;

  /**
   * Schedules whose delivery falls inside quiet hours, paired with the next
   * eligible delivery time. Recomputed against the current timezone offset.
   */
  const deferredSchedules: DeferredSchedule[] = [];
  if (quietHours && quietHours.enabled) {
    for (const schedule of schedules) {
      const scheduledMs = Date.parse(schedule.scheduledAt);
      if (!Number.isFinite(scheduledMs)) continue;
      const scheduledDate = new Date(scheduledMs);
      if (isWithinQuietHours(minutesSinceMidnight(scheduledDate), quietHours)) {
        deferredSchedules.push({
          schedule,
          nextEligibleAt: computeNextEligibleAt(scheduledDate, quietHours).toISOString(),
        });
      }
    }
  }

  return {
    clockStatus,
    checkClock,
    recordDose,
    visibleSchedules,
    isClockTrusted: clockStatus.state === 'trusted',
    quietHoursStatus,
    deferredSchedules,
    refreshQuietHours,
  };
}

export default useMedicationReminders;
