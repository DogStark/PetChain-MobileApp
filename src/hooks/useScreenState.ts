import { useCallback, useMemo, useState } from 'react';

/**
 * Shared offline-first screen state taxonomy.
 *
 * Offline, empty, permission-denied and server-error states are distinct so
 * screens can render a specific message and a specific, non-destructive action.
 */
export type ScreenStateKind =
  | 'loading'
  | 'ready'
  | 'offline'
  | 'empty'
  | 'permission-denied'
  | 'server-error';

export type ScreenStateActionKind = 'retry' | 'reconnect' | 'request-access' | 'create' | 'none';

export interface ScreenStateAction {
  kind: ScreenStateActionKind;
  label: string;
  /**
   * Whether the action discards local data or forces a destructive refresh.
   * Offline states must never expose a destructive action.
   */
  destructive: boolean;
}

export interface ScreenState {
  kind: ScreenStateKind;
  message: string;
  action: ScreenStateAction;
}

const NO_ACTION: ScreenStateAction = { kind: 'none', label: '', destructive: false };

/**
 * Canonical definitions for every state. Each state has a specific message and
 * a specific action; offline never suggests a destructive refresh, and empty is
 * never used for authorization failures.
 */
export const SCREEN_STATES: Record<ScreenStateKind, ScreenState> = {
  loading: {
    kind: 'loading',
    message: 'Loading…',
    action: NO_ACTION,
  },
  ready: {
    kind: 'ready',
    message: '',
    action: NO_ACTION,
  },
  offline: {
    kind: 'offline',
    message: "You're offline. Showing saved data.",
    action: { kind: 'reconnect', label: 'Reconnect', destructive: false },
  },
  empty: {
    kind: 'empty',
    message: 'Nothing here yet.',
    action: { kind: 'create', label: 'Add the first one', destructive: false },
  },
  'permission-denied': {
    kind: 'permission-denied',
    message: "You don't have access to this.",
    action: { kind: 'request-access', label: 'Request access', destructive: false },
  },
  'server-error': {
    kind: 'server-error',
    message: 'Something went wrong on our end.',
    action: { kind: 'retry', label: 'Try again', destructive: false },
  },
};

export interface ResolveScreenStateInput {
  isLoading?: boolean;
  isOffline?: boolean;
  /** True when the request failed with an authorization/permission error. */
  isPermissionDenied?: boolean;
  /** True when the request failed with a server (5xx) error. */
  isServerError?: boolean;
  /** True when the request succeeded but returned no items. */
  isEmpty?: boolean;
}

/**
 * Resolves the single applicable state for a screen.
 *
 * Precedence is deliberate: loading, then offline, then authorization, then
 * server errors, and only then empty. This guarantees an authorization failure
 * is never reported as an empty state.
 */
export function resolveScreenState(input: ResolveScreenStateInput): ScreenState {
  if (input.isLoading) return SCREEN_STATES.loading;
  if (input.isOffline) return SCREEN_STATES.offline;
  if (input.isPermissionDenied) return SCREEN_STATES['permission-denied'];
  if (input.isServerError) return SCREEN_STATES['server-error'];
  if (input.isEmpty) return SCREEN_STATES.empty;
  return SCREEN_STATES.ready;
}

export interface UseScreenStateResult extends ScreenState {
  /** Re-resolves the state, e.g. after a retry or reconnect. */
  refresh: () => void;
}

/**
 * Hook wrapper around {@link resolveScreenState} for screens that need to
 * re-evaluate their state after an action.
 */
export function useScreenState(input: ResolveScreenStateInput): UseScreenStateResult {
  const [nonce, setNonce] = useState(0);

  const state = useMemo(() => resolveScreenState(input), [
    input.isLoading,
    input.isOffline,
    input.isPermissionDenied,
    input.isServerError,
    input.isEmpty,
    nonce,
  ]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, refresh };
}
