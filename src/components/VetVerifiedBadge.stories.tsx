import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import { VetVerifiedBadge } from './VetVerifiedBadge';

/**
 * `VetVerifiedBadge` — A visual indicator showing that a veterinarian's
 * identity has been verified via Stellar federation.
 *
 * Displays a green checkmark badge with the vet's federated address.
 * Automatically hides when `verified={false}`.
 *
 * ### Props
 * | Prop | Type | Default | Description |
 * |------|------|---------|-------------|
 * | `federatedAddress` | `string` | — | Stellar federated address (e.g., `dr.smith*vetclinic.com`) |
 * | `verified` | `boolean` | — | Whether the vet is verified |
 * | `compact` | `boolean` | `false` | Show icon only, hide address text |
 *
 * ### Usage
 * ```tsx
 * <VetVerifiedBadge
 *   federatedAddress="dr.smith*vetclinic.com"
 *   verified={true}
 * />
 * ```
 */
const meta: Meta<typeof VetVerifiedBadge> = {
  title: 'Components/VetVerifiedBadge',
  component: VetVerifiedBadge,
  decorators: [
    (Story) => (
      <View style={{ padding: 24, backgroundColor: '#fff' }}>
        <Story />
      </View>
    ),
  ],
  argTypes: {
    federatedAddress: { control: 'text' },
    verified: { control: 'boolean' },
    compact: { control: 'boolean' },
  },
};

export default meta;

type Story = StoryObj<typeof VetVerifiedBadge>;

/** Verified vet with full federated address displayed. */
export const Verified: Story = {
  args: {
    federatedAddress: 'dr.smith*vetclinic.com',
    verified: true,
    compact: false,
  },
};

/** Compact mode shows only the checkmark icon. */
export const Compact: Story = {
  args: {
    federatedAddress: 'dr.jones*animalcare.org',
    verified: true,
    compact: true,
  },
};

/** Long federated address is truncated with ellipsis. */
export const LongAddress: Story = {
  args: {
    federatedAddress: 'dr.verylongname.specialist*veterinaryhospitalnetwork.com',
    verified: true,
    compact: false,
  },
};

/** Unverified vet — badge is hidden (renders null). */
export const Unverified: Story = {
  args: {
    federatedAddress: 'dr.unverified*example.com',
    verified: false,
    compact: false,
  },
};

/** Multiple badges in a list layout. */
export const MultipleBadges: Story = {
  render: () => (
    <View style={{ gap: 12 }}>
      <VetVerifiedBadge federatedAddress="dr.smith*vetclinic.com" verified={true} />
      <VetVerifiedBadge federatedAddress="dr.jones*animalcare.org" verified={true} compact />
      <VetVerifiedBadge federatedAddress="dr.specialist*veterinaryhospital.com" verified={true} />
    </View>
  ),
};
