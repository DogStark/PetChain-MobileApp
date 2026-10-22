import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

/**
 * Shared offline-first state taxonomy.
 *
 * Offline, empty, permission-denied and server-error states must be visually
 * and semantically distinct so users retry the right action:
 *  - offline: no destructive refresh, only a safe retry when connectivity returns
 *  - empty: only for genuinely empty data, never for authorization failures
 *  - permission-denied: no retry, points at account/access instead
 *  - server-error: safe retry allowed
 */
export type StateKind = 'offline' | 'empty' | 'permission-denied' | 'server-error';

export interface StateAction {
  label: string;
  onPress: () => void;
  /** Destructive actions (e.g. pull-to-refresh that discards local data) are never offered for offline. */
  destructive?: boolean;
}

export interface StateDescriptor {
  kind: StateKind;
  title: string;
  message: string;
  action?: StateAction;
}

const STATE_COPY: Record<StateKind, { title: string; message: string }> = {
  offline: {
    title: "You're offline",
    message: 'Check your connection. Your data is safe and will sync when you are back online.',
  },
  empty: {
    title: 'Nothing here yet',
    message: 'There is no data to show. Add something new to get started.',
  },
  'permission-denied': {
    title: 'Access denied',
    message: 'You do not have permission to view this. Contact your administrator if you need access.',
  },
  'server-error': {
    title: 'Something went wrong',
    message: 'We could not load this right now. Please try again.',
  },
};

/**
 * Build a state descriptor with a state-specific message and action.
 *
 * - offline never receives a destructive action (no destructive refresh).
 * - permission-denied never receives a retry action.
 * - empty is only produced for genuinely empty data, never for auth failures.
 */
export function describeState(
  kind: StateKind,
  action?: StateAction,
): StateDescriptor {
  const copy = STATE_COPY[kind];

  let resolvedAction = action;
  if (kind === 'offline' && resolvedAction?.destructive) {
    resolvedAction = undefined;
  }
  if (kind === 'permission-denied') {
    resolvedAction = undefined;
  }

  return {
    kind,
    title: copy.title,
    message: copy.message,
    action: resolvedAction,
  };
}

/**
 * Map a failed request to the correct state kind.
 * Authorization failures must never be reported as empty.
 */
export function stateFromError(error: { status?: number; code?: string } | null | undefined): StateKind {
  if (!error) {
    return 'empty';
  }
  if (error.code === 'OFFLINE' || error.status === 0) {
    return 'offline';
  }
  if (error.status === 401 || error.status === 403) {
    return 'permission-denied';
  }
  return 'server-error';
}

interface StateViewProps {
  kind: StateKind;
  action?: StateAction;
}

export function StateView({ kind, action }: StateViewProps) {
  const state = describeState(kind, action);

  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>{state.title}</Text>
      <Text style={styles.message}>{state.message}</Text>
      {state.action ? (
        <TouchableOpacity
          style={styles.action}
          onPress={state.action.onPress}
          accessibilityRole="button"
        >
          <Text style={styles.actionLabel}>{state.action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  action: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default StateView;
