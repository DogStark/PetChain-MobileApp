import type { Meta, StoryObj } from '@storybook/react';
import { Text, TouchableOpacity, View } from 'react-native';

import SyncBanner from './SyncBanner';

/**
 * `SyncBanner` — A self-contained banner that surfaces the
 * {@link useOfflineSync} queue state. Hidden when there is nothing to show.
 *
 * Visual states:
 * - **Idle** (online, no pending, no error, no sync) — renders nothing.
 * - **Pending** — amber card with "⏳ N changes pending sync" + "Sync now" button.
 * - **Syncing** — same card, button label flipped + spinner.
 * - **Offline + pending** — same shape; status line shows offline state.
 * - **Error** — pending card plus a red error line above the button.
 *
 * The component consumes `useOfflineSync`, so it auto-updates as the network
 * flips and as the queue processes.
 *
 * ### Usage
 * ```tsx
 * // Drop into a layout (e.g. near the top of a screen)
 * <SyncBanner />
 * ```
 *
 * > **Note:** Storybook does not activate the live `offlineQueue`, so the
 * > `Default` story renders `null`. The variants below use a static
 * > `Banner` preview that mirrors the runtime styling.
 */
const meta: Meta<typeof SyncBanner> = {
  title: 'Components/SyncBanner',
  component: SyncBanner,
};

export default meta;

type Story = StoryObj<typeof SyncBanner>;

interface BannerProps {
  status: string;
  error?: string | null;
  lastSyncIso?: string | null;
  buttonLabel?: string;
  buttonDisabled?: boolean;
}

/** Static visual preview matching the runtime component's styling. */
const Banner = ({
  status,
  error = null,
  lastSyncIso = null,
  buttonLabel = 'Sync now',
  buttonDisabled = false,
}: BannerProps) => (
  <View
    style={{
      backgroundColor: '#fff3e0',
      borderRadius: 10,
      padding: 12,
      margin: 12,
      borderWidth: 1,
      borderColor: '#ed6c02',
    }}
    accessibilityRole="alert"
  >
    <Text style={{ fontSize: 14, fontWeight: '600', color: '#1a1a1a' }}>{status}</Text>
    {error ? <Text style={{ fontSize: 13, color: '#d32f2f', marginTop: 6 }}>{error}</Text> : null}
    {lastSyncIso ? (
      <Text style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
        Last synced: {new Date(lastSyncIso).toLocaleTimeString()}
      </Text>
    ) : null}
    <TouchableOpacity
      disabled={buttonDisabled}
      style={{
        marginTop: 10,
        backgroundColor: buttonDisabled ? '#a5d6a7' : '#4CAF50',
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: 'center',
      }}
      accessibilityRole="button"
      accessibilityLabel={buttonLabel}
    >
      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{buttonLabel}</Text>
    </TouchableOpacity>
  </View>
);

/** Live component — hidden when the device is online and the queue is empty. */
export const Default: Story = {};

/** Pending state — multiple items waiting to be flushed. */
export const Pending: Story = {
  render: () => <Banner status="⏳ 3 changes pending sync" />,
};

/** Syncing state — items flushing, button disabled. */
export const Syncing: Story = {
  render: () => (
    <Banner
      status="🔄 Syncing…"
      lastSyncIso={new Date(Date.now() - 60_000).toISOString()}
      buttonLabel="Syncing…"
      buttonDisabled
    />
  ),
};

/** Offline + pending state — shows offline message. */
export const Offline: Story = {
  render: () => <Banner status="📴 Offline · 5 changes pending" />,
};

/** Error state — pending items plus a persistent error message. */
export const Error: Story = {
  render: () => (
    <Banner
      status="⏳ 2 changes pending sync"
      error="2 item(s) failed to sync and will be retried."
    />
  ),
};

/** Fully recovered state — banner vanishes (the `Default` story already
 *  shows the live component rendering `null`, but this variant intents
 *  documentation by showing the empty state implicitly via absence). */
