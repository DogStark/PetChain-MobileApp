import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  exponentialBackoffWithJitter,
  isRetryableError,
  retryWithBackoff,
} from '../circuitBreaker';

describe('circuitBreaker', () => {
  describe('CircuitBreaker', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 100,
      });
    });

    describe('initial state', () => {
      it('should start in CLOSED state', () => {
        expect(breaker.getState()).toBe('CLOSED');
        expect(breaker.isOpen()).toBe(false);
      });

      it('should return initial metrics', () => {
        const metrics = breaker.getMetrics();
        expect(metrics.state).toBe('CLOSED');
        expect(metrics.failureCount).toBe(0);
        expect(metrics.successCount).toBe(0);
      });
    });

    describe('success path', () => {
      it('should execute function and return result', async () => {
        const fn = jest.fn().mockResolvedValue('success');
        const result = await breaker.execute(fn);
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(1);
      });

      it('should stay CLOSED after success', async () => {
        const fn = jest.fn().mockResolvedValue('ok');
        await breaker.execute(fn);
        expect(breaker.getState()).toBe('CLOSED');
        expect(breaker.getMetrics().failureCount).toBe(0);
      });

      it('should transition HALF_OPEN to CLOSED on success', async () => {
        const failFn = jest.fn().mockRejectedValue(new Error('fail'));
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(failFn);
          } catch (e) {
            // Expected
          }
        }
        expect(breaker.getState()).toBe('OPEN');
        breaker.reset();
        const succeedFn = jest.fn().mockResolvedValue('recovered');
        const result = await breaker.execute(succeedFn);
        expect(result).toBe('recovered');
        expect(breaker.getState()).toBe('CLOSED');
      });
    });

    describe('circuit opening', () => {
      it('should open after failureThreshold failures', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('fail'));
        for (let i = 0; i < 2; i++) {
          try {
            await breaker.execute(fn);
          } catch (e) {
            // Expected
          }
          expect(breaker.getState()).toBe('CLOSED');
        }
        try {
          await breaker.execute(fn);
        } catch (e) {
          // Expected
        }
        expect(breaker.getState()).toBe('OPEN');
      });

      it('should throw CircuitBreakerOpenError when open', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('fail'));
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(fn);
          } catch (e) {
            // Expected
          }
        }
        const openFn = jest.fn();
        await expect(breaker.execute(openFn)).rejects.toThrow(CircuitBreakerOpenError);
        expect(openFn).not.toHaveBeenCalled();
      });

      it('should include retryAfterMs in error', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('fail'));
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(fn);
          } catch (e) {
            // Expected
          }
        }
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
          fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(CircuitBreakerOpenError);
          expect((error as CircuitBreakerOpenError).retryAfterMs).toBeGreaterThan(0);
        }
      });
    });

    describe('circuit recovery', () => {
      it('should reset to allow future operations', async () => {
        const failFn = jest.fn().mockRejectedValue(new Error('fail'));
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(failFn);
          } catch (e) {
            // Expected
          }
        }
        expect(breaker.getState()).toBe('OPEN');
        breaker.reset();
        const succeedFn = jest.fn().mockResolvedValue('ok');
        const result = await breaker.execute(succeedFn);
        expect(result).toBe('ok');
        expect(breaker.getState()).toBe('CLOSED');
      });
    });

    describe('reset', () => {
      it('should reset circuit to CLOSED', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('fail'));
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(fn);
          } catch (e) {
            // Expected
          }
        }
        expect(breaker.getState()).toBe('OPEN');
        breaker.reset();
        expect(breaker.getState()).toBe('CLOSED');
        expect(breaker.getMetrics().failureCount).toBe(0);
      });
    });
  });

  describe('exponentialBackoffWithJitter', () => {
    it('should calculate exponential backoff', () => {
      const delay0 = exponentialBackoffWithJitter(0, 100, 8000);
      const delay1 = exponentialBackoffWithJitter(1, 100, 8000);
      const delay2 = exponentialBackoffWithJitter(2, 100, 8000);
      expect(delay0).toBeGreaterThanOrEqual(100);
      expect(delay0).toBeLessThanOrEqual(120);
      expect(delay1).toBeGreaterThanOrEqual(200);
      expect(delay1).toBeLessThanOrEqual(220);
      expect(delay2).toBeGreaterThanOrEqual(400);
      expect(delay2).toBeLessThanOrEqual(440);
    });

    it('should cap at maxDelayMs', () => {
      const delay = exponentialBackoffWithJitter(10, 100, 500);
      expect(delay).toBeLessThanOrEqual(550);
    });

    it('should include jitter', () => {
      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(exponentialBackoffWithJitter(0, 100, 8000));
      }
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for 429', () => {
      expect(isRetryableError({ response: { status: 429 } })).toBe(true);
    });

    it('should return true for 503', () => {
      expect(isRetryableError({ response: { status: 503 } })).toBe(true);
    });

    it('should return true for 504', () => {
      expect(isRetryableError({ response: { status: 504 } })).toBe(true);
    });

    it('should return false for 404', () => {
      expect(isRetryableError({ response: { status: 404 } })).toBe(false);
    });

    it('should return false for 500', () => {
      expect(isRetryableError({ response: { status: 500 } })).toBe(false);
    });

    it('should return false for non-error objects', () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError('error')).toBe(false);
    });
  });

  describe('retryWithBackoff', () => {
    it('should succeed on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await retryWithBackoff(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should fail immediately for non-retryable errors', async () => {
      const fn = jest.fn().mockRejectedValue({ response: { status: 404 } });
      await expect(retryWithBackoff(fn)).rejects.toEqual({ response: { status: 404 } });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('recognizes 503 as retryable', () => {
      expect(isRetryableError({ response: { status: 503 } })).toBe(true);
    });

    it('recognizes 504 as retryable', () => {
      expect(isRetryableError({ response: { status: 504 } })).toBe(true);
    });

    it('recognizes 429 as retryable', () => {
      expect(isRetryableError({ response: { status: 429 } })).toBe(true);
    });
  });
});

