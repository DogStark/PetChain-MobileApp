/**
 * usePet Custom Hook — Issue #814
 *
 * Fetches, caches, and manages a single pet profile with loading and error
 * state.
 *
 * Usage:
 *   const { pet, isLoading, error, refetch } = usePet(petId);
 *
 * Behaviour:
 * - Fetches the pet by ID on mount (and whenever `petId` changes).
 * - Caches the result locally via petService (which uses SQLite under the
 *   hood), so the data is available offline on subsequent renders.
 * - Populates `error` on failure; the component can surface it or call
 *   `refetch` to retry.
 * - `refetch` resets error/loading state and triggers a fresh fetch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getPetById, type Pet } from '../services/petService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface UsePetResult {
  /** The fetched pet profile, or `null` while loading / on error. */
  pet: Pet | null;
  /** `true` while the network/cache request is in flight. */
  isLoading: boolean;
  /** Non-null when the most recent fetch attempt failed. */
  error: Error | null;
  /** Manually re-fetch the pet (e.g. after an edit or on pull-to-refresh). */
  refetch: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param petId - The ID of the pet to load. Pass `null` or `undefined` to
 *                skip the fetch entirely (hook stays idle).
 */
export function usePet(petId: string | null | undefined): UsePetResult {
  const [pet, setPet] = useState<Pet | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Increment this counter to trigger a re-fetch without changing petId
  const [fetchCount, setFetchCount] = useState(0);

  // Track mount state to avoid state updates after unmount
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Core fetch logic
  useEffect(() => {
    if (!petId) {
      // Nothing to load — reset to idle state
      if (isMounted.current) {
        setPet(null);
        setIsLoading(false);
        setError(null);
      }
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (isMounted.current) {
        setIsLoading(true);
        setError(null);
      }

      try {
        const result = await getPetById(petId);

        if (!cancelled && isMounted.current) {
          setPet(result);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled && isMounted.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setPet(null);
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
    // fetchCount is intentionally included so refetch() re-runs this effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petId, fetchCount]);

  /**
   * Triggers a fresh fetch. Clears the current error and re-sets loading state
   * before the request fires.
   */
  const refetch = useCallback(() => {
    setFetchCount((c) => c + 1);
  }, []);

  return { pet, isLoading, error, refetch };
}

export default usePet;
