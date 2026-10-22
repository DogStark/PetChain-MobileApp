import { useCallback, useState } from 'react';

export interface RetryOptions {
  maxRetries?: number;
  autoRetry?: boolean;
  onError?: (error: Error) => void;
}

export interface RetryState {
  loading: boolean;
  error: Error | null;
  retryCount: number;
}

export function useRetry<T>(
  asyncFn: () => Promise<T>,
  options: RetryOptions = {},
): [RetryState, () => Promise<T | undefined>, () => void] {
  const { maxRetries = 3, autoRetry = false, onError } = options;

  const [state, setState] = useState<RetryState>({
    loading: false,
    error: null,
    retryCount: 0,
  });

  const execute = useCallback(
    async (attempt = 0): Promise<T | undefined> => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const result = await asyncFn();
        setState({ loading: false, error: null, retryCount: attempt });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');

        if (attempt < maxRetries && autoRetry) {
          setState((prev) => ({ ...prev, retryCount: attempt + 1 }));
          return execute(attempt + 1);
        }

        setState({ loading: false, error, retryCount: attempt });
        onError?.(error);
        return undefined;
      }
    },
    [asyncFn, maxRetries, autoRetry, onError],
  );

  const reset = useCallback(() => {
    setState({ loading: false, error: null, retryCount: 0 });
  }, []);

  return [state, execute, reset];
}
