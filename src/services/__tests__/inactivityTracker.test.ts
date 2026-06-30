/**
 * Unit tests for src/services/inactivityTracker.ts
 */

import { InactivityTracker, SESSION_TIMEOUT_MS, WARNING_BEFORE_EXPIRY_MS } from '../inactivityTracker';

describe('InactivityTracker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exports SESSION_TIMEOUT_MS as 30 minutes', () => {
    expect(SESSION_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it('exports WARNING_BEFORE_EXPIRY_MS as 2 minutes', () => {
    expect(WARNING_BEFORE_EXPIRY_MS).toBe(2 * 60 * 1000);
  });

  describe('onWarning / onExpired listeners', () => {
    it('fires warning listener when warning period begins', () => {
      const tracker = new InactivityTracker();
      const warningListener = jest.fn();
      tracker.onWarning(warningListener);

      tracker.reset();

      // Advance to just before the warning timer fires
      jest.advanceTimersByTime(SESSION_TIMEOUT_MS - WARNING_BEFORE_EXPIRY_MS - 1);
      expect(warningListener).not.toHaveBeenCalled();

      // Advance past the warning threshold
      jest.advanceTimersByTime(2);
      expect(warningListener).toHaveBeenCalled();
      expect(warningListener.mock.calls[0][0]).toMatchObject({
        secondsRemaining: expect.any(Number),
      });

      tracker.clear();
    });

    it('fires expired listener after full timeout elapses', () => {
      const tracker = new InactivityTracker();
      const expiredListener = jest.fn();
      tracker.onExpired(expiredListener);

      tracker.reset();

      // Advance through warning period + all countdown seconds
      jest.advanceTimersByTime(SESSION_TIMEOUT_MS + 1000);
      expect(expiredListener).toHaveBeenCalledTimes(1);

      tracker.clear();
    });

    it('clears timers and stops events after clear()', () => {
      const tracker = new InactivityTracker();
      const warningListener = jest.fn();
      const expiredListener = jest.fn();
      tracker.onWarning(warningListener);
      tracker.onExpired(expiredListener);

      tracker.reset();
      tracker.clear();

      jest.advanceTimersByTime(SESSION_TIMEOUT_MS + 10000);

      expect(warningListener).not.toHaveBeenCalled();
      expect(expiredListener).not.toHaveBeenCalled();
    });

    it('restarting reset() cancels previous timers', () => {
      const tracker = new InactivityTracker();
      const warningListener = jest.fn();
      tracker.onWarning(warningListener);

      tracker.reset();
      // Advance partway
      jest.advanceTimersByTime(SESSION_TIMEOUT_MS - WARNING_BEFORE_EXPIRY_MS - 1000);
      // Reset again — should restart the full timer
      tracker.reset();
      // Advance the remainder of the original timer — warning should NOT fire yet
      jest.advanceTimersByTime(1001);
      expect(warningListener).not.toHaveBeenCalled();

      tracker.clear();
    });

    it('unsubscribe function stops warning notifications', () => {
      const tracker = new InactivityTracker();
      const listener = jest.fn();
      const unsubscribe = tracker.onWarning(listener);
      unsubscribe();

      tracker.reset();
      jest.advanceTimersByTime(SESSION_TIMEOUT_MS);

      expect(listener).not.toHaveBeenCalled();
      tracker.clear();
    });

    it('unsubscribe function stops expired notifications', () => {
      const tracker = new InactivityTracker();
      const listener = jest.fn();
      const unsubscribe = tracker.onExpired(listener);
      unsubscribe();

      tracker.reset();
      jest.advanceTimersByTime(SESSION_TIMEOUT_MS + 10000);

      expect(listener).not.toHaveBeenCalled();
      tracker.clear();
    });
  });
});
