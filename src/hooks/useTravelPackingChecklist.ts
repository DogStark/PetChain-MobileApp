import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { useScreenState } from './useScreenState';
import {
  TravelPackingChecklist,
  TravelPackingChecklistItem,
  TravelPackingCategory,
  TravelPackingChecklistService,
  TravelPackingPermissionResult,
} from '../services/TravelPackingChecklistService';

export const MAX_SYNC_RETRIES = 3;

export type TravelPackingScreenState =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error'
  | 'permission-denied'
  | 'stale';

export interface UseTravelPackingChecklistResult {
  checklist: TravelPackingChecklist | null;
  loading: boolean;
  error: Error | null;
  permissionDenied: boolean;
  isStale: boolean;
  screenState: TravelPackingScreenState;
  toggleItem: (itemId: string) => Promise<void>;
  addItem: (category: TravelPackingCategory, name: string) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  renameItem: (itemId: string, name: string) => Promise<void>;
  retry: () => Promise<void>;
}

interface UseTravelPackingChecklistOptions {
  service?: TravelPackingChecklistService;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_SYNC_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await delay(2 ** attempt * 250);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Operation failed after retries');
}

function isPermissionDeniedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { code?: string; status?: number; permissionDenied?: boolean };
  return (
    anyErr.permissionDenied === true ||
    anyErr.code === 'PERMISSION_DENIED' ||
    anyErr.status === 403
  );
}

function isStaleError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { code?: string; status?: number; stale?: boolean };
  return anyErr.stale === true || anyErr.code === 'STALE_DATA' || anyErr.status === 409;
}

function cloneChecklist(checklist: TravelPackingChecklist): TravelPackingChecklist {
  return {
    ...checklist,
    categories: checklist.categories.map((category) => ({
      ...category,
      items: category.items.map((item) => ({ ...item })),
    })),
  };
}

function findItem(
  checklist: TravelPackingChecklist,
  itemId: string,
): { category: TravelPackingCategory; item: TravelPackingChecklistItem } | null {
  for (const category of checklist.categories) {
    const item = category.items.find((candidate) => candidate.id === itemId);
    if (item) return { category, item };
  }
  return null;
}

function generateLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useTravelPackingChecklist(
  petId: string,
  tripId: string,
  tripName: string,
  options: UseTravelPackingChecklistOptions = {},
): UseTravelPackingChecklistResult {
  const service = options.service ?? TravelPackingChecklistService.getInstance();
  const { isOnline } = useNetworkStatus();

  const [checklist, setChecklist] = useState<TravelPackingChecklist | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [isStale, setIsStale] = useState<boolean>(false);

  const mountedRef = useRef<boolean>(true);
  const syncInFlightRef = useRef<boolean>(false);
  const permissionRef = useRef<TravelPackingPermissionResult | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const checkPermission = useCallback(async (): Promise<boolean> => {
    try {
      const result = await service.checkPermission(petId);
      permissionRef.current = result;
      return result.granted === true;
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        permissionRef.current = { granted: false };
        return false;
      }
      throw err;
    }
  }, [service, petId]);

  const syncInBackground = useCallback(async () => {
    if (!isOnline || syncInFlightRef.current) return;
    if (permissionRef.current && permissionRef.current.granted !== true) return;

    syncInFlightRef.current = true;
    try {
      const granted = await checkPermission();
      if (!granted) {
        if (mountedRef.current) {
          setPermissionDenied(true);
          setIsStale(false);
        }
        return;
      }

      const synced = await withRetry(() => service.syncChecklist(petId, tripId, tripName));
      if (!mountedRef.current) return;

      setChecklist(synced);
      setIsStale(false);
      setPermissionDenied(false);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      if (isPermissionDeniedError(err)) {
        setPermissionDenied(true);
        setIsStale(false);
      } else if (isStaleError(err)) {
        setIsStale(true);
      } else {
        setError(err instanceof Error ? err : new Error('Sync failed'));
      }
    } finally {
      syncInFlightRef.current = false;
    }
  }, [isOnline, checkPermission, service, petId, tripId, tripName]);

  const load = useCallback(async () => {
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
      setPermissionDenied(false);
      setIsStale(false);
    }

    try {
      const granted = await checkPermission();
      if (!mountedRef.current) return;

      if (!granted) {
        setPermissionDenied(true);
        setChecklist(null);
        setLoading(false);
        return;
      }

      const loaded = await withRetry(() => service.loadChecklist(petId, tripId, tripName));
      if (!mountedRef.current) return;

      setChecklist(loaded);
      setLoading(false);
      setIsStale(false);

      // Kick off a background sync when online and permitted.
      void syncInBackground();
    } catch (err) {
      if (!mountedRef.current) return;
      setLoading(false);
      if (isPermissionDeniedError(err)) {
        setPermissionDenied(true);
        setChecklist(null);
      } else if (isStaleError(err)) {
        setIsStale(true);
      } else {
        setError(err instanceof Error ? err : new Error('Failed to load checklist'));
      }
    }
  }, [checkPermission, service, petId, tripId, tripName, syncInBackground]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petId, tripId]);

  const persistLocal = useCallback(
    async (next: TravelPackingChecklist) => {
      try {
        await service.saveLocalChecklist(petId, tripId, next);
      } catch {
        // Local persistence failures should not block optimistic UI.
      }
    },
    [service, petId, tripId],
  );

  const applyOptimisticUpdate = useCallback(
    async (updater: (current: TravelPackingChecklist) => TravelPackingChecklist) => {
      let next: TravelPackingChecklist | null = null;
      setChecklist((current) => {
        if (!current) return current;
        next = updater(cloneChecklist(current));
        return next;
      });

      if (next) {
        await persistLocal(next);
        void syncInBackground();
      }
    },
    [persistLocal, syncInBackground],
  );

  const toggleItem = useCallback(
    async (itemId: string) => {
      await applyOptimisticUpdate((current) => {
        const found = findItem(current, itemId);
        if (found) {
          found.item.checked = !found.item.checked;
        }
        return current;
      });
    },
    [applyOptimisticUpdate],
  );

  const addItem = useCallback(
    async (category: TravelPackingCategory, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await applyOptimisticUpdate((current) => {
        const target = current.categories.find((cat) => cat.id === category.id);
        if (target) {
          target.items.push({
            id: generateLocalId(),
            name: trimmed,
            checked: false,
            categoryId: target.id,
          });
        }
        return current;
      });
    },
    [applyOptimisticUpdate],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      await applyOptimisticUpdate((current) => {
        current.categories = current.categories.map((category) => ({
          ...category,
          items: category.items.filter((item) => item.id !== itemId),
        }));
        return current;
      });
    },
    [applyOptimisticUpdate],
  );

  const renameItem = useCallback(
    async (itemId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await applyOptimisticUpdate((current) => {
        const found = findItem(current, itemId);
        if (found) {
          found.item.name = trimmed;
        }
        return current;
      });
    },
    [applyOptimisticUpdate],
  );

  const retry = useCallback(async () => {
    await load();
  }, [load]);

  const screenState = useScreenState<TravelPackingScreenState>({
    loading,
    error,
    permissionDenied,
    isStale,
    isEmpty:
      !loading &&
      !error &&
      !permissionDenied &&
      !isStale &&
      checklist !== null &&
      checklist.categories.every((category) => category.items.length === 0),
    readyState: 'ready',
    emptyState: 'empty',
    errorState: 'error',
    loadingState: 'loading',
    permissionDeniedState: 'permission-denied',
    staleState: 'stale',
  });

  return useMemo(
    () => ({
      checklist,
      loading,
      error,
      permissionDenied,
      isStale,
      screenState,
      toggleItem,
      addItem,
      removeItem,
      renameItem,
      retry,
    }),
    [
      checklist,
      loading,
      error,
      permissionDenied,
      isStale,
      screenState,
      toggleItem,
      addItem,
      removeItem,
      renameItem,
      retry,
    ],
  );
}

export default useTravelPackingChecklist;