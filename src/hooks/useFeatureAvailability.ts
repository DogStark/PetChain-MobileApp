import { useCallback, useEffect, useMemo, useState } from 'react';

import type { FeatureFlag } from '../config/constants';
import {
  fetchFeatureAvailability,
  resolveFeatureAvailability,
  type FeatureAvailabilitySnapshot,
  type FeatureAvailabilityState,
} from '../services/featureAvailabilityService';

export interface UseFeatureAvailabilityResult {
  state: FeatureAvailabilityState;
  loading: boolean;
  /** Re-checks with the server, e.g. from a "Check again" action. */
  refresh: () => void;
}

/**
 * Availability for one feature. Renders from the cached snapshot immediately
 * and refreshes from the server in the background.
 */
export function useFeatureAvailability(feature: FeatureFlag): UseFeatureAvailabilityResult {
  const [snapshot, setSnapshot] = useState<FeatureAvailabilitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const next = await fetchFeatureAvailability();
    setSnapshot(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const state = useMemo(() => resolveFeatureAvailability(feature, snapshot), [feature, snapshot]);

  return { state, loading, refresh: load };
}

export default useFeatureAvailability;
