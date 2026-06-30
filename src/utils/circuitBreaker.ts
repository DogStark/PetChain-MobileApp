/**
 * Circuit Breaker Pattern Implementation
 * 
 * States:
 * - CLOSED: Normal operation, all requests pass through
 * - OPEN: Too many failures, reject all requests immediately
 * - HALF_OPEN: Testing if service recovered, allow single request
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening (default: 3)
  successThreshold: number; // Number of successes in HALF_OPEN to close (default: 1)
  timeout: number; // Time before trying to recover from OPEN state (ms, default: 8000)
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastStateChangeTime: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: number;
  private lastStateChangeTime = Date.now();
  private readonly config: Required<CircuitBreakerConfig>;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 3,
      successThreshold: config.successThreshold ?? 1,
      timeout: config.timeout ?? 8000,
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - (this.lastFailureTime || 0);
      if (timeSinceLastFailure >= this.config.timeout) {
        this.transitionTo('HALF_OPEN');
      } else {
        throw new CircuitBreakerOpenError(
          'Circuit breaker is OPEN. Service is unavailable.',
          this.config.timeout - timeSinceLastFailure,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount += 1;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('CLOSED');
      }
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount += 1;

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === 'HALF_OPEN') {
      this.successCount = 0;
    }

    this.state = newState;
    this.lastStateChangeTime = Date.now();
  }

  /**
   * Get current circuit breaker metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChangeTime: this.lastStateChangeTime,
    };
  }

  /**
   * Manually reset the circuit breaker to CLOSED state
   */
  reset(): void {
    this.transitionTo('CLOSED');
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.state === 'OPEN';
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * Exponential backoff with jitter
 * @param attempt - Attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay cap
 * @returns Delay in milliseconds
 */
export const exponentialBackoffWithJitter = (
  attempt: number,
  baseDelayMs: number = 100,
  maxDelayMs: number = 8000,
): number => {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  const jitter = Math.random() * cappedDelay * 0.1; // 10% jitter
  return cappedDelay + jitter;
};

/**
 * Determines if an error is retryable (5xx or 429 Too Many Requests)
 */
export const isRetryableError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;

  const err = error as {
    response?: { status?: number };
    status?: number;
  };

  const status = err.response?.status ?? err.status;
  return status === 429 || status === 503 || status === 504;
};

/**
 * Retry wrapper with exponential backoff and jitter
 */
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {},
): Promise<T> => {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 8000;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const delay = exponentialBackoffWithJitter(attempt, baseDelayMs, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};
