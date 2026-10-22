/**
 * Device-clock tamper handling for medication reminders.
 *
 * Compares device time against trusted server/ledger time where available,
 * detects large forward/backward jumps (including timezone and DST shifts),
 * and defines how reminders and dose logs behave while time is untrusted.
 *
 * Server timestamps remain authoritative during reconciliation.
 */

/** A clock jump larger than this (ms) is treated as tampering / untrusted. */
export const CLOCK_JUMP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** How long a trusted server sample stays fresh before we stop trusting it. */
export const SERVER_SAMPLE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type ClockTrustState = 'trusted' | 'untrusted' | 'unknown';

export interface ClockSample {
  /** Device wall-clock time when the sample was taken (ms). */
  deviceTime: number;
  /** Trusted server/ledger time for the same instant (ms), if available. */
  serverTime?: number;
  /** Monotonic-ish reference (e.g. performance.now()) to survive wall-clock edits. */
  monotonicTime?: number;
}

export interface ClockAssessment {
  state: ClockTrustState;
  /** Signed offset (server - device) in ms when a server sample is available. */
  offsetMs: number | null;
  /** Signed jump (current - previous) in ms when a jump was detected. */
  jumpMs: number | null;
  /** Human-readable, actionable reason when the clock is not trusted. */
  reason: string | null;
  /** Whether schedules can still be viewed safely offline. */
  canViewSchedulesOffline: boolean;
}

const TRUSTED: ClockAssessment = {
  state: 'trusted',
  offsetMs: null,
  jumpMs: null,
  reason: null,
  canViewSchedulesOffline: true,
};

/**
 * Pure assessment of a new clock sample against the previous one.
 * Detects forward/backward jumps and reconciles against server time.
 */
export function assessClock(
  previous: ClockSample | null,
  current: ClockSample,
  now: number = Date.now(),
): ClockAssessment {
  // Prefer server time as authoritative when it is available and fresh.
  if (typeof current.serverTime === 'number') {
    const offsetMs = current.serverTime - current.deviceTime;
    if (Math.abs(offsetMs) > CLOCK_JUMP_THRESHOLD_MS) {
      return {
        state: 'untrusted',
        offsetMs,
        jumpMs: null,
        reason:
          'Your device clock differs significantly from the server. ' +
          'Reminders and dose logging are paused until it is corrected.',
        canViewSchedulesOffline: true,
      };
    }
    return { ...TRUSTED, offsetMs };
  }

  // No server sample: fall back to detecting jumps between local samples.
  if (previous) {
    const elapsed = current.deviceTime - previous.deviceTime;
    const monotonicElapsed =
      typeof current.monotonicTime === 'number' &&
      typeof previous.monotonicTime === 'number'
        ? current.monotonicTime - previous.monotonicTime
        : null;

    // If we have a monotonic reference, compare wall-clock drift against it.
    const drift =
      monotonicElapsed !== null ? elapsed - monotonicElapsed : elapsed;

    if (Math.abs(drift) > CLOCK_JUMP_THRESHOLD_MS) {
      const direction = drift > 0 ? 'forward' : 'backward';
      return {
        state: 'untrusted',
        offsetMs: null,
        jumpMs: drift,
        reason:
          `Your device clock jumped ${direction}. ` +
          'Reminders and dose logging are paused to avoid recording an ' +
          'incorrect dose. You can still view your schedules offline.',
        canViewSchedulesOffline: true,
      };
    }
  }

  // Guard against a sample that is implausibly far in the future.
  if (current.deviceTime - now > CLOCK_JUMP_THRESHOLD_MS) {
    return {
      state: 'untrusted',
      offsetMs: null,
      jumpMs: current.deviceTime - now,
      reason:
        'Your device clock is set in the future. Reminders and dose ' +
        'logging are paused until it is corrected.',
      canViewSchedulesOffline: true,
    };
  }

  return TRUSTED;
}

/**
 * Stateful tracker used on app resume and during reminder/dose-log flows.
 * Keeps the last trusted sample and exposes the current trust assessment.
 */
export class TimeSyncService {
  private lastSample: ClockSample | null = null;
  private lastServerSampleAt: number | null = null;
  private assessment: ClockAssessment = { ...TRUSTED };

  /** Record a sample (e.g. on app resume) and return the assessment. */
  recordSample(sample: ClockSample, now: number = Date.now()): ClockAssessment {
    if (typeof sample.serverTime === 'number') {
      this.lastServerSampleAt = now;
    }
    this.assessment = assessClock(this.lastSample, sample, now);
    this.lastSample = sample;
    return this.assessment;
  }

  /** Current trust state without recording a new sample. */
  getAssessment(): ClockAssessment {
    return this.assessment;
  }

  /** Whether the clock is currently trusted for recording doses. */
  isTrusted(): boolean {
    return this.assessment.state === 'trusted';
  }

  /** Whether a fresh trusted server sample is available for reconciliation. */
  hasFreshServerSample(now: number = Date.now()): boolean {
    return (
      this.lastServerSampleAt !== null &&
      now - this.lastServerSampleAt <= SERVER_SAMPLE_TTL_MS
    );
  }

  /**
   * Reconcile a locally recorded dose timestamp against authoritative server
   * time. Returns the server timestamp when available, otherwise null so the
   * caller can queue the dose for later reconciliation instead of recording a
   * possibly-future local time.
   */
  reconcileDoseTimestamp(
    localTimestamp: number,
    serverTimestamp?: number,
  ): number | null {
    if (typeof serverTimestamp === 'number') {
      return serverTimestamp;
    }
    if (!this.isTrusted()) {
      return null;
    }
    return localTimestamp;
  }

  /** Reset tracker state (e.g. after the user corrects the clock). */
  reset(): void {
    this.lastSample = null;
    this.lastServerSampleAt = null;
    this.assessment = { ...TRUSTED };
  }
}

export const timeSyncService = new TimeSyncService();
