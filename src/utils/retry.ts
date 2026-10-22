export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  backoffMultiplier?: number;
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const anyError = error as any;
    return !anyError.response && anyError.request;
  }
  return true;
}

function getStatus(error: unknown): number | undefined {
  if (error instanceof Error) {
    const anyError = error as any;
    return anyError.response?.status;
  }
  return undefined;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries = 3, initialDelay = 1000, backoffMultiplier = 2 } = options;

  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      const status = getStatus(error);
      const retryable = isNetworkError(error) || (typeof status === 'number' && status >= 500);

      if (!retryable || attempt >= maxRetries) {
        throw error;
      }

      const delayMs = initialDelay * backoffMultiplier ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt++;
    }
  }
}
