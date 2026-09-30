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

export interface DoseLogEntry {
  scheduleId: string;
  /** Server/ledger timestamp when the dose was recorded, if known. */
  recordedAt: string;
}

export interface UseMedicationRemindersOptions {
  schedules: MedicationSchedule[];
  doseLogs: DoseLogEntry[];
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

export function useMedicationReminders({
  schedules,
  doseLogs,
  getTrustedTime,
  onRecordDose,
}: UseMedicationRemindersOptions) {
  const [clockStatus, setClockStatus] = useState<ClockStatus>(INITIAL_STATUS);

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

  // Detect clock changes on app resume.
  useEffect(() => {
    const handleResume = () => {
      void checkClock();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleResume);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleResume);
    }

    void checkClock();

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleResume);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleResume);
      }
    };
  }, [checkClock]);

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

  return {
    clockStatus,
    checkClock,
    recordDose,
    visibleSchedules,
    isClockTrusted: clockStatus.state === 'trusted',
  };
}

export default useMedicationReminders;
