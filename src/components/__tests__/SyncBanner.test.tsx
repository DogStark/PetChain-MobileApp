/**
 * Component-level tests for SyncBanner.
 *
 * The hook consumed by SyncBanner is well-tested in
 * `src/hooks/__tests__/useOfflineSync.{test.ts,renderer.test.tsx}`.
 * These tests exercise SyncBanner's own rendering logic: visibility,
 * status-text mapping, pluralization, lastSync / error rows, and the
 * "Sync now" button (label, disabled state, onPress wiring).
 *
 * Implementation notes:
 * - Project test environment is `node` (no jsdom), and `react-test-renderer`
 *   provides `act` and `create` but no DOM queries. We therefore find
 *   elements via `testID` props, which the react-native mock forwards to
 *   the generated host element (see src/__mocks__/react-native.ts).
 * - The tree is created **once** in `beforeEach` (mirroring the working
 *   `useOfflineSync.renderer.test.tsx` pattern). Subsequent tests drive
 *   state changes by mutating `mockState` and calling `tree.update()` so
 *   the same TestRenderer instance is reused and `.root` stays valid.
 * - Each test asserts `expect(tree).not.toBeNull()` before any DOM-level
 *   access so a mount failure cannot silently propagate as `.toBeTruthy()`
 *   on `undefined`.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { UseOfflineSyncResult } from '../../hooks/useOfflineSync';

// ─── Mock state controlled by tests ──────────────────────────────────────────

let mockState: UseOfflineSyncResult = makeDefaultState();

function makeDefaultState(): UseOfflineSyncResult {
  return {
    isOnline: true,
    pendingCount: 0,
    isSyncing: false,
    lastSync: null,
    error: null,
    // Typed as `jest.MockedFunction<…>` so consumers can spy on call counts
    // without an `as jest.Mock` cast at every assertion site.
    triggerSync: jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<
      UseOfflineSyncResult['triggerSync']
    >,
  };
}

jest.mock('../../hooks/useOfflineSync', () => ({
  __esModule: true,
  default: () => mockState,
}));

// Import after the jest.mock so the test resolves the mocked hook.
import SyncBanner from '../SyncBanner';

function setMockState(overrides: Partial<UseOfflineSyncResult>): void {
  mockState = { ...makeDefaultState(), ...overrides };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Collect every string fragment rendered anywhere in the tree, flattening
 * one level of array-shaped children. This handles both `<Text>foo</Text>`
 * (single string child) and `<Text>foo {bar}</Text>` (array of strings),
 * which appears inside SyncBanner for the `lastSync` row.
 */
function getAllStrings(tree: ReactTestRenderer): string[] {
  const out: string[] = [];
  for (const node of tree.root.findAll(() => true)) {
    const c = node.props.children;
    if (typeof c === 'string') {
      out.push(c);
    } else if (Array.isArray(c)) {
      for (const child of c as unknown[]) {
        if (typeof child === 'string') {
          out.push(child);
        }
      }
    }
  }
  return out;
}

function findFirstStringContaining(tree: ReactTestRenderer, fragment: string): string | undefined {
  return getAllStrings(tree).find((text) => text.includes(fragment));
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let tree: ReactTestRenderer | null = null;

beforeEach(async () => {
  jest.clearAllMocks();
  setMockState({});

  await act(async () => {
    tree = create(React.createElement(SyncBanner));
  });
});

afterEach(() => {
  if (tree) {
    tree.unmount();
    tree = null;
  }
});

function rerender(): void {
  if (!tree) throw new Error('SyncBanner test: tree not initialized');
  // Bind to a local non-null const so the downstream callback and any future
  // helper calls bypass the `@typescript-eslint/no-non-null-assertion` rule.
  const current = tree;
  act(() => {
    current.update(React.createElement(SyncBanner));
  });
}

// Each assertion that touches the rendered tree guards on `tree` being
// non-null so a mount regression fails loudly instead of returning
// `undefined`. The explicit `expect(tree).not.toBeNull()` also documents
// the lifecycle invariant.
function assertMounted(): ReactTestRenderer {
  expect(tree).not.toBeNull();
  return tree as ReactTestRenderer;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SyncBanner', () => {
  describe('visibility', () => {
    it('renders nothing when online with empty queue and no error', () => {
      setMockState({ isOnline: true, pendingCount: 0, error: null });
      rerender();
      const t = assertMounted();
      expect(t.root.children.length).toBe(0);
    });

    it('renders the banner when pendingCount > 0', () => {
      setMockState({ isOnline: true, pendingCount: 2 });
      rerender();
      expect(assertMounted().root.findByProps({ testID: 'sync-banner' })).toBeTruthy();
    });

    it('renders the banner when offline', () => {
      setMockState({ isOnline: false });
      rerender();
      expect(assertMounted().root.findByProps({ testID: 'sync-banner' })).toBeTruthy();
    });

    it('renders the banner while syncing', () => {
      setMockState({ isOnline: true, pendingCount: 1, isSyncing: true });
      rerender();
      expect(assertMounted().root.findByProps({ testID: 'sync-banner' })).toBeTruthy();
    });

    it('renders the banner when an error is present even with empty queue', () => {
      setMockState({ isOnline: true, error: '1 item(s) failed to sync and will be retried.' });
      rerender();
      expect(assertMounted().root.findByProps({ testID: 'sync-banner' })).toBeTruthy();
    });
  });

  describe('status text', () => {
    it('shows "🔄 Syncing…" while syncing', () => {
      setMockState({ isOnline: true, pendingCount: 4, isSyncing: true });
      rerender();
      expect(findFirstStringContaining(assertMounted(), '🔄 Syncing')).toBe('🔄 Syncing…');
    });

    it('shows plain "📴 Offline" when offline with no pending', () => {
      setMockState({ isOnline: false, pendingCount: 0 });
      rerender();
      expect(findFirstStringContaining(assertMounted(), '📴 Offline')).toBe('📴 Offline');
    });

    it('shows "📴 Offline · 1 change pending" (singular)', () => {
      setMockState({ isOnline: false, pendingCount: 1 });
      rerender();
      expect(findFirstStringContaining(assertMounted(), 'Offline')).toBe(
        '📴 Offline · 1 change pending',
      );
    });

    it('shows "📴 Offline · 5 changes pending" (plural)', () => {
      setMockState({ isOnline: false, pendingCount: 5 });
      rerender();
      expect(findFirstStringContaining(assertMounted(), 'Offline')).toBe(
        '📴 Offline · 5 changes pending',
      );
    });

    it('shows "⏳ 1 change pending sync" (singular) when online+pending', () => {
      setMockState({ isOnline: true, pendingCount: 1 });
      rerender();
      expect(findFirstStringContaining(assertMounted(), 'pending sync')).toBe(
        '⏳ 1 change pending sync',
      );
    });

    it('shows "⏳ 3 changes pending sync" (plural) when online+pending', () => {
      setMockState({ isOnline: true, pendingCount: 3 });
      rerender();
      expect(findFirstStringContaining(assertMounted(), 'pending sync')).toBe(
        '⏳ 3 changes pending sync',
      );
    });
  });

  describe('error row', () => {
    it('renders the error message when error is present', () => {
      setMockState({
        isOnline: true,
        pendingCount: 2,
        error: '2 item(s) failed to sync and will be retried.',
      });
      rerender();
      expect(findFirstStringContaining(assertMounted(), 'failed to sync')).toBe(
        '2 item(s) failed to sync and will be retried.',
      );
    });

    it('does not render any "failed" text when error is null', () => {
      setMockState({ isOnline: true, pendingCount: 1, error: null });
      rerender();
      const strings = getAllStrings(assertMounted());
      expect(strings.find((s) => s.toLowerCase().includes('failed'))).toBeUndefined();
    });
  });

  describe('lastSync row', () => {
    it('renders a "Last synced: …" row when lastSync is a timestamp', () => {
      setMockState({ isOnline: true, pendingCount: 1, lastSync: 1_700_000_000_000 });
      rerender();
      // The Text element renders an array of children:
      //   ["Last synced: ", new Date(lastSync).toLocaleTimeString()]
      // so we look for either half independently.
      const strings = getAllStrings(assertMounted());
      expect(strings.some((s) => s.startsWith('Last synced:'))).toBe(true);
    });

    it('does not render the lastSync row when lastSync is null', () => {
      setMockState({ isOnline: true, pendingCount: 1, lastSync: null });
      rerender();
      expect(findFirstStringContaining(assertMounted(), 'Last synced')).toBeUndefined();
    });
  });

  describe('"Sync now" button', () => {
    it('renders the button with "Sync now" label when not syncing', () => {
      setMockState({ isOnline: true, pendingCount: 2, isSyncing: false });
      rerender();
      expect(getAllStrings(assertMounted())).toContain('Sync now');
    });

    it('disables the button while syncing and shows "Syncing…" label', () => {
      setMockState({ isOnline: true, pendingCount: 4, isSyncing: true });
      rerender();

      const button = assertMounted().root.findByProps({ testID: 'sync-banner-button' });
      expect(button.props.disabled).toBe(true);

      const labels = getAllStrings(assertMounted());
      expect(labels).toContain('Syncing…');
      expect(labels).not.toContain('Sync now');
    });

    it('calls triggerSync when the button is pressed', () => {
      setMockState({ isOnline: true, pendingCount: 2 });
      rerender();

      const button = assertMounted().root.findByProps({ testID: 'sync-banner-button' });
      act(() => {
        button.props.onPress();
      });
      expect(mockState.triggerSync).toHaveBeenCalledTimes(1);
    });

    it('exposes a non-disabled button when not syncing', () => {
      setMockState({ isOnline: true, pendingCount: 2, isSyncing: false });
      rerender();
      const button = assertMounted().root.findByProps({ testID: 'sync-banner-button' });
      // TouchableOpacity's `disabled` only blocks native tap events; calling
      // onPress() directly via React bypasses that gate. We verify the
      // surface flag is `false` here so the OS-level hit target accepts taps.
      expect(button.props.disabled).toBe(false);
    });
  });

  describe('accessibility wiring', () => {
    it('exposes testID="sync-banner" and accessibilityRole="alert"', () => {
      setMockState({ isOnline: true, pendingCount: 1 });
      rerender();
      const banner = assertMounted().root.findByProps({ testID: 'sync-banner' });
      expect(banner.props.accessibilityRole).toBe('alert');
      expect(banner.props.accessibilityLiveRegion).toBe('polite');
    });

    it('exposes testID and accessibilityLabel on the button', () => {
      setMockState({ isOnline: true, pendingCount: 1 });
      rerender();
      const button = assertMounted().root.findByProps({ testID: 'sync-banner-button' });
      expect(button.props.accessibilityLabel).toBe('Sync now');
      expect(button.props.accessibilityRole).toBe('button');
      expect(button.props.accessibilityState).toEqual({ disabled: false });
    });

    it('reflects accessibilityState.disabled=true while syncing', () => {
      setMockState({ isOnline: true, pendingCount: 1, isSyncing: true });
      rerender();
      const button = assertMounted().root.findByProps({ testID: 'sync-banner-button' });
      expect(button.props.accessibilityState).toEqual({ disabled: true });
    });
  });
});
