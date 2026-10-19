import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../services/apiClient';
import { withRetry } from '../utils/retry';

export type RoutineDayStatus = 'completed' | 'skipped' | 'unknown';

export interface RoutineDay {
  date: string; // ISO date (YYYY-MM-DD)
  status: RoutineDayStatus;
}

export interface RoutineStreak {
  current: number;
  longest: number;
}

interface CompletionApiResponse {
  days?: Array<{ date: string; status?: string }>;
  streak?: { current?: number; longest?: number };
}

export interface UseRoutineStreakCalendarResult {
  days: RoutineDay[];
  streak: RoutineStreak;
  isLoading: boolean;
  isStale: boolean;
  isOffline: boolean;
  isPermissionDenied: boolean;
  isServerError: boolean;
  isEmpty: boolean;
  error: string | null;
  retry: () => void;
  goToPrevMonth: () => void;
  goToNextMonth: () => void;
  selectedDate: string | null;
  selectDate: (date: string | null) => void;
}

interface CacheEntry {
  days: RoutineDay[];
  streak: RoutineStreak;
  monthKey: string;
}

const CACHE_PREFIX = 'routine-streak-cache:';

function toMonthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function monthBounds(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month, 1));
  const to = new Date(Date.UTC(year, month + 1, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function normalizeStatus(status: string | undefined): RoutineDayStatus {
  if (status === 'completed') return 'completed';
  if (status === 'skipped') return 'skipped';
  // Missing or unrecognized data must never be treated as missed care.
  return 'unknown';
}

function normalizeDays(raw: CompletionApiResponse['days']): RoutineDay[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is { date: string; status?: string } => !!d && typeof d.date === 'string')
    .map((d) => ({ date: d.date, status: normalizeStatus(d.status) }));
}

function normalizeStreak(raw: CompletionApiResponse['streak']): RoutineStreak {
  return {
    current: typeof raw?.current === 'number' && raw.current >= 0 ? raw.current : 0,
    longest: typeof raw?.longest === 'number' && raw.longest >= 0 ? raw.longest : 0,
  };
}

function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { isNetworkError?: boolean; code?: string; name?: string; message?: string };
  if (anyErr.isNetworkError) return true;
  if (anyErr.code === 'NETWORK_ERROR' || anyErr.code === 'ECONNABORTED') return true;
  if (anyErr.name === 'NetworkError') return true;
  if (typeof anyErr.message === 'string' && /network|offline|failed to fetch/i.test(anyErr.message)) {
    return true;
  }
  return false;
}

function getStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const anyErr = err as { status?: number; statusCode?: number; response?: { status?: number } };
  return anyErr.status ?? anyErr.statusCode ?? anyErr.response?.status;
}

function readCache(petId: string, monthKey: string): CacheEntry | null {
  try {
    const raw = globalThis.localStorage?.getItem(`${CACHE_PREFIX}${petId}:${monthKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || !Array.isArray(parsed.days)) return null;
    return {
      days: parsed.days.map((d) => ({ date: d.date, status: normalizeStatus(d.status) })),
      streak: normalizeStreak(parsed.streak),
      monthKey: parsed.monthKey,
    };
  } catch {
    return null;
  }
}

function writeCache(petId: string, entry: CacheEntry): void {
  try {
    globalThis.localStorage?.setItem(
      `${CACHE_PREFIX}${petId}:${entry.monthKey}`,
      JSON.stringify(entry),
    );
  } catch {
    // Cache writes are best-effort; ignore storage failures.
  }
}

export function useRoutineStreakCalendar(petId: string | null | undefined): UseRoutineStreakCalendarResult {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState<number>(now.getUTCFullYear());
  const [month, setMonth] = useState<number>(now.getUTCMonth());
  const [days, setDays] = useState<RoutineDay[]>([]);
  const [streak, setStreak] = useState<RoutineStreak>({ current: 0, longest: 0 });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [isPermissionDenied, setIsPermissionDenied] = useState<boolean>(false);
  const [isServerError, setIsServerError] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const requestIdRef = useRef<number>(0);

  const monthKey = toMonthKey(year, month);

  const fetchMonth = useCallback(
    async (signal: { cancelled: boolean }) => {
      if (!petId) {
        setDays([]);
        setStreak({ current: 0, longest: 0 });
        setIsLoading(false);
        setIsStale(false);
        setIsOffline(false);
        setIsPermissionDenied(false);
        setIsServerError(false);
        setError(null);
        return;
      }

      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);
      setIsPermissionDenied(false);
      setIsServerError(false);

      const { from, to } = monthBounds(year, month);

      try {
        const response = await withRetry(() =>
          apiClient.get<CompletionApiResponse>(
            `/api/routines/${encodeURIComponent(petId)}/completion`,
            { params: { from, to } },
          ),
        );

        if (signal.cancelled || requestId !== requestIdRef.current) return;

        const payload = (response as { data?: CompletionApiResponse })?.data ?? (response as CompletionApiResponse);
        const normalizedDays = normalizeDays(payload?.days);
        const normalizedStreak = normalizeStreak(payload?.streak);

        setDays(normalizedDays);
        setStreak(normalizedStreak);
        setIsStale(false);
        setIsOffline(false);
        setIsPermissionDenied(false);
        setIsServerError(false);
        setError(null);

        writeCache(petId, { days: normalizedDays, streak: normalizedStreak, monthKey });
      } catch (err) {
        if (signal.cancelled || requestId !== requestIdRef.current) return;

        const status = getStatus(err);

        if (status === 401 || status === 403) {
          // Server-confirmed denial: never present as empty data.
          setDays([]);
          setStreak({ current: 0, longest: 0 });
          setIsPermissionDenied(true);
          setIsOffline(false);
          setIsServerError(false);
          setIsStale(false);
          setError('You do not have permission to view this routine.');
          return;
        }

        if (isNetworkError(err)) {
          const cached = readCache(petId, monthKey);
          if (cached) {
            setDays(cached.days);
            setStreak(cached.streak);
            setIsStale(true);
          } else {
            setDays([]);
            setStreak({ current: 0, longest: 0 });
            setIsStale(false);
          }
          setIsOffline(true);
          setIsPermissionDenied(false);
          setIsServerError(false);
          setError('You appear to be offline. Showing saved data if available.');
          return;
        }

        // Server or unknown error: keep any previously loaded data, flag error.
        setIsOffline(false);
        setIsPermissionDenied(false);
        setIsServerError(true);
        setError('Something went wrong while loading your routine. Please try again.');
      } finally {
        if (!signal.cancelled && requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [petId, year, month, monthKey],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void fetchMonth(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [fetchMonth, reloadToken]);

  const retry = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const goToPrevMonth = useCallback(() => {
    setSelectedDate(null);
    setMonth((prevMonth) => {
      if (prevMonth === 0) {
        setYear((prevYear) => prevYear - 1);
        return 11;
      }
      return prevMonth - 1;
    });
  }, []);

  const goToNextMonth = useCallback(() => {
    setSelectedDate(null);
    setMonth((prevMonth) => {
      if (prevMonth === 11) {
        setYear((prevYear) => prevYear + 1);
        return 0;
      }
      return prevMonth + 1;
    });
  }, []);

  const selectDate = useCallback((date: string | null) => {
    setSelectedDate(date);
  }, []);

  const isEmpty = !isLoading && !isPermissionDenied && !isServerError && !isOffline && days.length === 0;

  return {
    days,
    streak,
    isLoading,
    isStale,
    isOffline,
    isPermissionDenied,
    isServerError,
    isEmpty,
    error,
    retry,
    goToPrevMonth,
    goToNextMonth,
    selectedDate,
    selectDate,
  };
}

export default useRoutineStreakCalendar;