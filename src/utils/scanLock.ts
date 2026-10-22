/**
 * QR scan lock / debounce — Issue #934
 *
 * Camera frames can decode the same tag many times before navigation completes,
 * firing duplicate actions. This small, dependency-free lock blocks subsequent
 * scans once the first has been accepted and provides an explicit `reset()` so
 * the screen can re-arm scanning on retry or app foreground.
 *
 * Keeping it a pure factory (instead of a React hook) makes the debounce/lifecycle
 * behaviour trivially unit-testable without mocks.
 */

export const DEFAULT_SCAN_DEBOUNCE_MS = 500;

export interface ScanLock {
  /**
   * Returns true when the incoming scan should be ignored:
   *  - the lock is currently held (a scan was accepted and not yet reset), or
   *  - the scan falls inside the debounce window.
   */
  shouldSkip(now?: number): boolean;
  /** Hold the lock so no further scans are accepted until {@link reset}. */
  lock(now?: number): void;
  /** Release the lock and clear the debounce window (retry / foreground). */
  reset(): void;
  isLocked(): boolean;
}

export function createScanLock(debounceMs: number = DEFAULT_SCAN_DEBOUNCE_MS): ScanLock {
  let lastScanAt = 0;
  let locked = false;

  return {
    shouldSkip(now = Date.now()): boolean {
      if (locked) return true;
      return now - lastScanAt < debounceMs;
    },
    lock(now = Date.now()): void {
      locked = true;
      lastScanAt = now;
    },
    reset(): void {
      locked = false;
      lastScanAt = 0;
    },
    isLocked(): boolean {
      return locked;
    },
  };
}
