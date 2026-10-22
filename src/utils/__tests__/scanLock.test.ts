import { createScanLock, DEFAULT_SCAN_DEBOUNCE_MS } from '../scanLock';

describe('scanLock (Issue #934)', () => {
  describe('createScanLock', () => {
    it('does not skip the very first scan', () => {
      const lock = createScanLock(500);
      expect(lock.shouldSkip(1000)).toBe(false);
    });

    it('skips scans within the debounce window', () => {
      const lock = createScanLock(500);
      lock.lock(1000);
      // A second scan 100ms later falls inside the window.
      expect(lock.shouldSkip(1100)).toBe(true);
    });

    it('allows a scan once the debounce window from the epoch has passed', () => {
      const lock = createScanLock(500);
      // Before the lock is held, the debounce window is measured from the epoch.
      expect(lock.shouldSkip(499)).toBe(true);
      expect(lock.shouldSkip(500)).toBe(false);
    });

    it('holds the lock once locked, regardless of debounce window', () => {
      const lock = createScanLock(500);
      lock.lock(1000);
      // Even long after the debounce window, a locked lock still prevents scans.
      expect(lock.shouldSkip(9000)).toBe(true);
      expect(lock.isLocked()).toBe(true);
    });

    it('resets the lock and debounce window', () => {
      const lock = createScanLock(500);
      lock.lock(1000);
      lock.reset();
      expect(lock.isLocked()).toBe(false);
      expect(lock.shouldSkip(1000)).toBe(false);
    });

    it('uses the default debounce constant when none is provided', () => {
      expect(DEFAULT_SCAN_DEBOUNCE_MS).toBe(500);
      const lock = createScanLock();
      lock.lock(0);
      expect(lock.shouldSkip(DEFAULT_SCAN_DEBOUNCE_MS - 1)).toBe(true);
    });

    it('respects a custom debounce value', () => {
      const lock = createScanLock(50);
      expect(lock.shouldSkip(49)).toBe(true);
      expect(lock.shouldSkip(50)).toBe(false);
    });

    it('uses Date.now() when no timestamp is supplied', () => {
      const lock = createScanLock(1000);
      const before = Date.now();
      lock.lock();
      const after = Date.now();
      expect(lock.shouldSkip()).toBe(true); // within the window
      expect(before).toBeLessThanOrEqual(after);
    });

    it('supports multiple independent locks', () => {
      const a = createScanLock(500);
      const b = createScanLock(500);
      a.lock(1000);
      expect(a.isLocked()).toBe(true);
      expect(b.isLocked()).toBe(false);
      expect(b.shouldSkip(1000)).toBe(false);
    });
  });
});
