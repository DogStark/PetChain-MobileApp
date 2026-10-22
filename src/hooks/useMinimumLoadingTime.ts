import { useEffect, useRef, useState } from 'react';

interface UseMinimumLoadingTimeOptions {
  /**
   * Minimum time in milliseconds the loading state should be shown
   * @default 300
   */
  minLoadingTime?: number;
}

/**
 * useMinimumLoadingTime Hook
 *
 * Ensures that the loading state is displayed for a minimum duration,
 * preventing jarring transitions when data loads very quickly.
 *
 * @param isLoading - Current loading state
 * @param options - Configuration options
 * @returns The effective loading state to display
 *
 * @example
 * const [data, setData] = useState(null);
 * const [isLoading, setIsLoading] = useState(true);
 * const displayLoading = useMinimumLoadingTime(isLoading, { minLoadingTime: 300 });
 *
 * useEffect(() => {
 *   fetchData().then(d => {
 *     setData(d);
 *     setIsLoading(false);
 *   });
 * }, []);
 *
 * return displayLoading ? <SkeletonCard /> : <Content data={data} />;
 */
export function useMinimumLoadingTime(
  isLoading: boolean,
  options: UseMinimumLoadingTimeOptions = {},
): boolean {
  const { minLoadingTime = 300 } = options;
  const [displayLoading, setDisplayLoading] = useState(isLoading);
  const loadingStartTime = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) {
      // Loading started
      loadingStartTime.current = Date.now();
      setDisplayLoading(true);

      // Clear any pending timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else {
      // Loading finished
      if (loadingStartTime.current === null) {
        setDisplayLoading(false);
        return;
      }

      const elapsedTime = Date.now() - loadingStartTime.current;
      const remainingTime = Math.max(0, minLoadingTime - elapsedTime);

      if (remainingTime > 0) {
        // Still need to wait
        timeoutRef.current = setTimeout(() => {
          setDisplayLoading(false);
          timeoutRef.current = null;
        }, remainingTime);
      } else {
        // Enough time has passed
        setDisplayLoading(false);
      }

      loadingStartTime.current = null;
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isLoading, minLoadingTime]);

  return displayLoading;
}
