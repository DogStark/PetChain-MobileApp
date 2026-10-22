/**
 * Inactivity Tracker
 *
 * Manages the session inactivity timer and the pre-expiry warning countdown.
 * Fires warning callbacks N milliseconds before the session expires, then
 * fires expiry callbacks when the timeout elapses.
 *
 * Fully decoupled from session storage and API calls so it can be tested
 * in isolation.
 */

/** How long (ms) a session may be idle before it expires. */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/** How many ms before expiry to start the warning countdown. */
export const WARNING_BEFORE_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes

export interface SessionTimeoutWarningPayload {
  /** Seconds remaining until auto-logout. */
  secondsRemaining: number;
}

type WarningListener = (payload: SessionTimeoutWarningPayload) => void;
type ExpiredListener = () => void;

export class InactivityTracker {
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private warningTimer: ReturnType<typeof setTimeout> | null = null;
  private warningCountdownInterval: ReturnType<typeof setInterval> | null = null;

  private warningListeners: WarningListener[] = [];
  private expiredListeners: ExpiredListener[] = [];

  // ── Listener registration ──────────────────────────────────────────────────

  onWarning(listener: WarningListener): () => void {
    this.warningListeners.push(listener);
    return () => {
      this.warningListeners = this.warningListeners.filter((l) => l !== listener);
    };
  }

  onExpired(listener: ExpiredListener): () => void {
    this.expiredListeners.push(listener);
    return () => {
      this.expiredListeners = this.expiredListeners.filter((l) => l !== listener);
    };
  }

  // ── Timer management ───────────────────────────────────────────────────────

  /**
   * Reset the inactivity timer (call on any user activity or navigation).
   * Clears any active warning countdown.
   */
  reset(): void {
    this.clear();

    const warningAt = SESSION_TIMEOUT_MS - WARNING_BEFORE_EXPIRY_MS;

    this.warningTimer = setTimeout(() => {
      this._startWarningCountdown();
    }, warningAt);
  }

  /** Clear all timers (call when the session ends). */
  clear(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
    if (this.warningCountdownInterval) {
      clearInterval(this.warningCountdownInterval);
      this.warningCountdownInterval = null;
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _startWarningCountdown(): void {
    let secondsRemaining = Math.round(WARNING_BEFORE_EXPIRY_MS / 1000);

    this.warningListeners.forEach((l) => l({ secondsRemaining }));

    this.warningCountdownInterval = setInterval(() => {
      secondsRemaining -= 1;
      this.warningListeners.forEach((l) => l({ secondsRemaining }));

      if (secondsRemaining <= 0) {
        if (this.warningCountdownInterval) clearInterval(this.warningCountdownInterval);
        this.warningCountdownInterval = null;
        this.expiredListeners.forEach((l) => l());
      }
    }, 1000);
  }
}
