import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { useOfflineSync } from './useOfflineSync';
import {
  fetchAdoptionApplicationProgress,
  AdoptionApplicationProgress,
  AdoptionApplicationProgressError,
} from '../services/adoptionApplicationProgressService';

export type AdoptionApplicationProgressStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error'
  | 'permissionDenied'
  | 'offline'
  | 'stale'
  | 'empty';

export interface UseAdoptionApplicationProgressResult {
  status: AdoptionApplicationProgressStatus;
  data: AdoptionApplicationProgress | null;
  loading: boolean;
  error: Error | null;
  permissionDenied: boolean;
  offline: boolean;
  stale: boolean;
  empty: boolean;
  lastUpdatedAt: string | null;
  retry: () => void;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

const CACHE_KEY_PREFIX = 'adoptionApplicationProgress:';

function isStale(lastUpdatedAt: string | null, now: number = Date.now()): boolean {
  if (!lastUpdatedAt) return false;
  const updated = new Date(lastUpdatedAt).getTime();
  if (Number.isNaN(updated)) return false;
  return now - updated > STALE_THRESHOLD_MS;
}

function isEmptyProgress(data: AdoptionApplicationProgress | null): boolean {
  if (!data) return true;
  const steps = data.steps ?? [];
  const documents = data.documents ?? [];
  return steps.length === 0 && documents.length === 0;
}

export function useAdoptionApplicationProgress(
  applicationId: string | null | undefined,
): UseAdoptionApplicationProgressResult {
  const { isConnected } = useNetworkStatus();
  const { getCachedItem, setCachedItem } = useOfflineSync();

  const [data, setData] = useState<AdoptionApplicationProgress | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false);

  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const cacheKey = applicationId ? `${CACHE_KEY_PREFIX}${applicationId}` : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadFromCache = useCallback(async (): Promise<boolean> => {
    if (!cacheKey) return false;
    try {
      const cached = await getCachedItem<AdoptionApplicationProgress>(cacheKey);
      if (!cached) return false;
      if (!mountedRef.current) return true;
      setData(cached);
      setLastUpdatedAt(cached.lastUpdatedAt ?? null);
      setHasLoadedOnce(true);
      return true;
    } catch {
      return false;
    }
  }, [cacheKey, getCachedItem]);

  const fetchProgress = useCallback(async () => {
    if (!applicationId) {
      setData(null);
      setLastUpdatedAt(null);
      setError(null);
      setPermissionDenied(false);
      setLoading(false);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setPermissionDenied(false);

    if (!isConnected) {
      const hadCache = await loadFromCache();
      if (!mountedRef.current || currentRequestId !== requestIdRef.current) return;
      setLoading(false);
      if (!hadCache) {
        setData(null);
        setLastUpdatedAt(null);
      }
      return;
    }

    try {
      const progress = await fetchAdoptionApplicationProgress(applicationId);
      if (!mountedRef.current || currentRequestId !== requestIdRef.current) return;

      // Defensive guard: never surface another applicant's data.
      if (progress.applicantId && progress.applicantId !== progress.requestedByApplicantId) {
        setPermissionDenied(true);
        setData(null);
        setLastUpdatedAt(null);
        setLoading(false);
        return;
      }

      setData(progress);
      setLastUpdatedAt(progress.lastUpdatedAt ?? new Date().toISOString());
      setHasLoadedOnce(true);
      setLoading(false);

      if (cacheKey) {
        try {
          await setCachedItem(cacheKey, progress);
        } catch {
          // Caching failure should not break the flow.
        }
      }
    } catch (err) {
      if (!mountedRef.current || currentRequestId !== requestIdRef.current) return;

      if (err instanceof AdoptionApplicationProgressError && err.code === 'PERMISSION_DENIED') {
        setPermissionDenied(true);
        setData(null);
        setLastUpdatedAt(null);
        setError(null);
        setLoading(false);
        return;
      }

      const hadCache = await loadFromCache();
      if (!mountedRef.current || currentRequestId !== requestIdRef.current) return;

      setError(err instanceof Error ? err : new Error('Failed to load application progress'));
      setLoading(false);
      if (!hadCache) {
        setData(null);
        setLastUpdatedAt(null);
      }
    }
  }, [applicationId, cacheKey, isConnected, loadFromCache, setCachedItem]);

  useEffect(() => {
    void fetchProgress();
  }, [fetchProgress]);

  const retry = useCallback(() => {
    void fetchProgress();
  }, [fetchProgress]);

  const offline = !isConnected;
  const stale = useMemo(() => isStale(lastUpdatedAt), [lastUpdatedAt]);
  const empty = useMemo(() => !loading && !error && !permissionDenied && isEmptyProgress(data), [
    loading,
    error,
    permissionDenied,
    data,
  ]);

  const status: AdoptionApplicationProgressStatus = useMemo(() => {
    if (loading) return 'loading';
    if (permissionDenied) return 'permissionDenied';
    if (offline && !hasLoadedOnce) return 'offline';
    if (error && !data) return 'error';
    if (stale) return 'stale';
    if (empty) return 'empty';
    if (data) return 'success';
    return 'idle';
  }, [loading, permissionDenied, offline, hasLoadedOnce, error, data, stale, empty]);

  return {
    status,
    data,
    loading,
    error,
    permissionDenied,
    offline,
    stale,
    empty,
    lastUpdatedAt,
    retry,
  };
}

export default useAdoptionApplicationProgress;