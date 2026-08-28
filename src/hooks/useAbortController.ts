/**
 * useAbortController — #975
 *
 * Standardizes API cancellation on screen unmount and on rapid navigation /
 * filter changes. Long-running requests otherwise resolve into an unmounted or
 * stale screen and keep the radio awake, wasting battery.
 *
 * Usage:
 *   const { getSignal, renew } = useAbortController();
 *
 *   // fetch tied to the current screen lifetime:
 *   useEffect(() => {
 *     petService.list({ signal: getSignal() }).then(setPets).catch(ignoreAbort);
 *   }, []);
 *
 *   // rapid filter change — abort the previous request, start a fresh scope:
 *   const onFilterChange = (f: Filter) => {
 *     const signal = renew();
 *     petService.list({ filter: f, signal }).then(setPets).catch(ignoreAbort);
 *   };
 *
 * Guarantees:
 * - The active controller is aborted exactly once, on unmount.
 * - `renew()` aborts the previous controller before handing back a new signal,
 *   so only the newest in-flight request can settle the screen.
 * - Safe under React 18 StrictMode double-invoke: a fresh controller is
 *   created on re-mount.
 */
import { useCallback, useEffect, useRef } from 'react';

export interface AbortControllerHandle {
  /** The signal for the current request scope. Stable until `renew()`. */
  getSignal: () => AbortSignal;
  /** Abort the current scope and open a new one; returns the new signal. */
  renew: () => AbortSignal;
  /** Abort the current scope without opening a new one. */
  abort: (reason?: unknown) => void;
}

export function useAbortController(): AbortControllerHandle {
  const ref = useRef<AbortController | null>(null);

  const current = useCallback((): AbortController => {
    if (!ref.current) ref.current = new AbortController();
    return ref.current;
  }, []);

  const getSignal = useCallback((): AbortSignal => current().signal, [current]);

  const abort = useCallback((reason?: unknown): void => {
    ref.current?.abort(reason);
  }, []);

  const renew = useCallback((): AbortSignal => {
    ref.current?.abort();
    ref.current = new AbortController();
    return ref.current.signal;
  }, []);

  useEffect(() => {
    // Ensure a controller exists for this mount.
    current();
    return () => {
      ref.current?.abort();
      ref.current = null;
    };
  }, [current]);

  return { getSignal, renew, abort };
}

/**
 * True when an error is the result of an `AbortController.abort()` — covers the
 * DOMException, axios `CanceledError` (`ERR_CANCELED`), and Node's
 * `ABORT_ERR`. Use it to swallow the expected rejection after cancellation:
 *   .catch((e) => { if (!isAbortError(e)) throw e; })
 */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string; message?: string };
  return (
    e.name === 'AbortError' ||
    e.name === 'CanceledError' ||
    e.code === 'ERR_CANCELED' ||
    e.code === 'ABORT_ERR' ||
    e.message === 'canceled'
  );
}

/** Convenience for `.catch(ignoreAbort)` — rethrows anything that is not an abort. */
export function ignoreAbort(err: unknown): void {
  if (!isAbortError(err)) throw err;
}

export default useAbortController;
