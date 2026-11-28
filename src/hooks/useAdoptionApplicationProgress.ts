import { useCallback, useEffect, useRef, useState } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import {
  getAdoptionApplicationProgress,
  isProgressStale,
  type AdoptionApplicationProgress,
} from '../services/adoptionApplicationProgressService';

export type AdoptionApplicationProgressStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error'
  | 'permission_denied'
  | 'offline';

export interface UseAdoptionApplicationProgressResult {
  status: AdoptionApplicationProgressStatus;
  data: AdoptionApplicationProgress | null;
  error: string | null;
  lastUpdatedAt: string | null;
  /** True when the data came from the local cache or is older than the freshness window. */
  isStale: boolean;
  refresh: () => void;
}

export function useAdoptionApplicationProgress(
  applicationId?: string,
): UseAdoptionApplicationProgressResult {
  const { isOnline } = useNetworkStatus();

  const [data, setData] = useState<AdoptionApplicationProgress | null>(null);
  const [status, setStatus] = useState<AdoptionApplicationProgressStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState<boolean>(false);

  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setStatus('loading');
    setError(null);

    const result = await getAdoptionApplicationProgress(applicationId);
    if (requestId !== requestIdRef.current) return;

    setData(result.data);
    setLastUpdatedAt(result.lastUpdatedAt);
    setFromCache(result.fromCache);

    if (result.error === 'permission-denied') {
      setStatus('permission_denied');
    } else if (!result.data && result.error === 'offline') {
      setStatus('offline');
    } else if (!result.data && result.error) {
      setStatus('error');
      setError('Unable to load application progress.');
    } else {
      // Includes a cached payload served during an offline or server error. It is flagged via isStale.
      setStatus('success');
    }
  }, [applicationId]);

  // Reload when connectivity changes so a reconnect replaces cached data.
  useEffect(() => {
    void load();
  }, [load, isOnline]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return {
    status,
    data,
    error,
    lastUpdatedAt,
    isStale: fromCache || isProgressStale(lastUpdatedAt),
    refresh,
  };
}

export default useAdoptionApplicationProgress;
