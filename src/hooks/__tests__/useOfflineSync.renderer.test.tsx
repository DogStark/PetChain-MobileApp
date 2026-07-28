/**
 * Renderer-level tests for useOfflineSync.
 *
 * The project test environment is `node` (no jsdom), and the installed
 * `react-test-renderer` exposes `act` and `create` but not `renderHook`.
 * We therefore use the wrapper-component pattern:
 *
 * 1. A `TestWrapper` component invokes the hook on every render and stores
 *    its return value in a module-level `latestResult`.
 * 2. The queue mock captures the listener registered via
 *    `offlineQueue.onStatusChange(applyStatus)`.
 * 3. Each test mounts the wrapper, asserts state, then invokes
 *    `capturedListener(newStatus)` inside `act(...)` to drive a real
 *    React-state-driven re-render and re-asserts.
 *
 * This exercises the *real* hook code (state, effects, error branches,
 * triggerSync handler), unlike the static mock-reimplementation tests in
 * `useOfflineSync.test.ts`.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// Mock offlineQueue at module level so the hook resolves it cleanly.
jest.mock('../../services/offlineQueue', () => ({
  offlineQueue: {
    initialize: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn(),
    onStatusChange: jest.fn(),
    processQueue: jest.fn(),
  },
}));

import { offlineQueue } from '../../services/offlineQueue';
import type { OfflineQueueStatus } from '../../services/offlineQueue';
import { useOfflineSync, type UseOfflineSyncResult } from '../useOfflineSync';

const q = offlineQueue as unknown as {
  initialize: jest.Mock;
  getStatus: jest.Mock;
  onStatusChange: jest.Mock;
  processQueue: jest.Mock;
};

// ─── Shared state captured by the wrapper ────────────────────────────────────

let latestResult: UseOfflineSyncResult | null = null;
let capturedListener: ((status: OfflineQueueStatus) => void) | null = null;
let capturedUnsubscribe: jest.Mock | null = null;
let tree: ReactTestRenderer | null = null;

function TestWrapper(): null {
  latestResult = useOfflineSync();
  return null;
}

const makeStatus = (overrides: Partial<OfflineQueueStatus> = {}): OfflineQueueStatus => ({
  isOnline: true,
  pendingCount: 0,
  isSyncing: false,
  lastSync: null,
  failedCount: 0,
  pendingConflicts: [],
  ...overrides,
});

// ─── Mock + lifecycle setup ──────────────────────────────────────────────────

beforeEach(async () => {
  jest.clearAllMocks();
  latestResult = null;
  capturedListener = null;
  capturedUnsubscribe = null;

  q.initialize.mockResolvedValue(undefined);
  q.getStatus.mockResolvedValue(makeStatus());
  q.onStatusChange.mockImplementation((fn: (status: OfflineQueueStatus) => void) => {
    capturedListener = fn;
    capturedUnsubscribe = jest.fn();
    return capturedUnsubscribe;
  });
  q.processQueue.mockResolvedValue(undefined);

  await act(async () => {
    tree = create(React.createElement(TestWrapper));
  });
});

afterEach(() => {
  if (tree) {
    tree.unmount();
    tree = null;
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useOfflineSync (renderer-level)', () => {
  it('mounts and exposes safe defaults while loading status from offlineQueue', () => {
    expect(latestResult).not.toBeNull();
    // initial useState defaults — matches the resolved async getStatus() too.
    expect(latestResult?.isOnline).toBe(true);
    expect(latestResult?.pendingCount).toBe(0);
    expect(latestResult?.isSyncing).toBe(false);
    expect(latestResult?.lastSync).toBeNull();
    expect(latestResult?.error).toBeNull();
    expect(typeof latestResult?.triggerSync).toBe('function');

    // The hook must wire up initialize + getStatus + onStatusChange on mount.
    expect(q.initialize).toHaveBeenCalledTimes(1);
    expect(q.getStatus).toHaveBeenCalledTimes(1);
    expect(q.onStatusChange).toHaveBeenCalledTimes(1);
    expect(typeof capturedListener).toBe('function');
    // onStatusChange should return a fresh unsubscribe function for cleanup.
    expect(typeof capturedUnsubscribe).toBe('function');
  });

  it('reflects queue updates pushed through capturedListener (isOnline + counts)', () => {
    expect(latestResult?.pendingCount).toBe(0);

    act(() => {
      capturedListener?.(makeStatus({ isOnline: false, pendingCount: 4, isSyncing: false }));
    });

    expect(latestResult?.isOnline).toBe(false);
    expect(latestResult?.pendingCount).toBe(4);
    expect(latestResult?.isSyncing).toBe(false);
  });

  it('records lastSync timestamps delivered via status updates', () => {
    const ts = 1_700_000_000_000;
    act(() => {
      capturedListener?.(makeStatus({ lastSync: ts }));
    });

    expect(latestResult?.lastSync).toBe(ts);
  });

  describe('applyStatus error branches', () => {
    it('sets a persistent error when failedCount > 0 after a sync finishes', () => {
      act(() => {
        capturedListener?.(makeStatus({ isSyncing: false, failedCount: 2, pendingCount: 2 }));
      });

      expect(latestResult?.error).toBe('2 item(s) failed to sync and will be retried.');
    });

    it('clears a stale error once the queue empties with zero failures', () => {
      // First, surface an error.
      act(() => {
        capturedListener?.(makeStatus({ isSyncing: false, failedCount: 1, pendingCount: 1 }));
      });
      expect(latestResult?.error).toMatch(/1 item\(s\) failed/);

      // Then, signal full recovery.
      act(() => {
        capturedListener?.(makeStatus({ isSyncing: false, failedCount: 0, pendingCount: 0 }));
      });
      expect(latestResult?.error).toBeNull();
    });

    it('keeps the error while isSyncing is true (mid-flush)', () => {
      act(() => {
        capturedListener?.(makeStatus({ isSyncing: false, failedCount: 1, pendingCount: 1 }));
      });
      expect(latestResult?.error).toMatch(/1 item\(s\) failed/);

      act(() => {
        capturedListener?.(makeStatus({ isSyncing: true, failedCount: 0, pendingCount: 0 }));
      });
      expect(latestResult?.error).toMatch(/1 item\(s\) failed/);
    });
  });

  describe('triggerSync', () => {
    it('clears the existing error and forwards to offlineQueue.processQueue', async () => {
      // First, put the hook into a visible error state.
      act(() => {
        capturedListener?.(makeStatus({ failedCount: 3, pendingCount: 3 }));
      });
      expect(latestResult?.error).toMatch(/3 item\(s\) failed/);

      await act(async () => {
        await latestResult?.triggerSync();
      });

      expect(q.processQueue).toHaveBeenCalledTimes(1);
      // triggerSync always resets error to null before awaiting processQueue.
      expect(latestResult?.error).toBeNull();
    });

    it('captures an Error message into hook state when processQueue rejects', async () => {
      q.processQueue.mockRejectedValueOnce(new Error('Network timeout'));

      await act(async () => {
        await latestResult?.triggerSync();
      });

      expect(latestResult?.error).toBe('Network timeout');
    });

    it('falls back to a generic message for non-Error rejections', async () => {
      q.processQueue.mockRejectedValueOnce('unexpected string rejection');

      await act(async () => {
        await latestResult?.triggerSync();
      });

      expect(latestResult?.error).toBe('An unexpected error occurred during sync.');
    });
  });

  it('unsubscribes on unmount and guards state updates after unmount', () => {
    // The hook must return the unsubscribe function from onStatusChange so the
    // cleanup path can detach the listener.
    const unsub = capturedUnsubscribe;
    expect(unsub).not.toBeNull();
    expect(unsub!.mock.calls.length).toBe(0);

    act(() => {
      tree?.unmount();
      tree = null;
    });

    expect(unsub!.mock.calls.length).toBe(1);

    // After unmount, the isMounted.current guard short-circuits the closure's
    // setter calls so calling the listener must not throw.
    expect(() => {
      capturedListener?.(makeStatus({ isOnline: false, pendingCount: 9 }));
    }).not.toThrow();

    // And the hook's returned values must not have changed past unmount
    // (latestResult is a module-level snapshot frozen at the last render).
    expect(latestResult?.pendingCount).not.toBe(9);
  });
});
