import { action } from '@storybook/addon-actions';
import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import { VerificationBadge, type VerificationStatus } from './VerificationBadge';

/**
 * `VerificationBadge` — A compact badge indicating the blockchain verification
 * status of a medical record.
 *
 * | Status | Icon | Colour |
 * |--------|------|--------|
 * | `verified` | ✓ | Green (#10B981) |
 * | `failed` | ✕ | Red (#EF4444) |
 * | `pending` | ⏳ | Amber (#F59E0B) |
 * | `unknown` | — | Gray (#F3F4F6) |
 *
 * Optionally renders a "Verify on Chain" button when `showButton=true` and
 * the status is not `verified`.
 *
 * ### Props
 * | Prop | Type | Default | Description |
 * |------|------|---------|-------------|
 * | `status` | `VerificationStatus` | `"unknown"` | Current verification state |
 * | `onVerifyPress` | `() => void` | — | Called when "Verify on Chain" is tapped |
 * | `showButton` | `boolean` | `false` | Show the verify action button |
 *
 * ### Usage
 * ```tsx
 * <VerificationBadge
 *   status={record.verificationStatus}
 *   showButton
 *   onVerifyPress={() => verifyOnChain(record.id)}
 * />
 * ```
 */
const meta: Meta<typeof VerificationBadge> = {
  title: 'Components/VerificationBadge',
  component: VerificationBadge,
  decorators: [
    (Story) => (
      <View style={{ padding: 24, backgroundColor: '#fff', alignItems: 'flex-start' }}>
        <Story />
      </View>
    ),
  ],
  argTypes: {
    status: {
      control: 'select',
      options: ['verified', 'failed', 'pending', 'unknown'] satisfies VerificationStatus[],
    },
    showButton: { control: 'boolean' },
  },
};

export default meta;

type Story = StoryObj<typeof VerificationBadge>;

/** Green badge — record has been verified on-chain. */
export const Verified: Story = {
  args: { status: 'verified', showButton: false },
};

/** Red badge — on-chain verification failed. */
export const Failed: Story = {
  args: {
    status: 'failed',
    showButton: true,
    onVerifyPress: action('onVerifyPress'),
  },
};

/** Amber badge — verification is in progress. */
export const Pending: Story = {
  args: { status: 'pending', showButton: false },
};

/** Gray badge — record has not been verified yet. */
export const Unknown: Story = {
  args: {
    status: 'unknown',
    showButton: true,
    onVerifyPress: action('onVerifyPress'),
  },
};

/** All four states side-by-side for quick visual comparison. */
export const AllStates: Story = {
  render: () => (
    <View style={{ gap: 12 }}>
      {(['verified', 'failed', 'pending', 'unknown'] as VerificationStatus[]).map((s) => (
        <VerificationBadge
          key={s}
          status={s}
          showButton={s !== 'verified'}
          onVerifyPress={action(`onVerifyPress-${s}`)}
        />
      ))}
    </View>
  ),
};
