import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import EmergencyCallButton from './EmergencyCallButton';

/**
 * `EmergencyCallButton` — A prominent, accessible call button that uses the
 * device phone API (`Linking`) to place a direct call.
 *
 * Designed for emergency situations:
 * - Confirms before dialling (optional, skippable for speed)
 * - Falls back gracefully if the device cannot make calls
 * - Accessible label for screen readers
 *
 * ### Usage
 * ```tsx
 * <EmergencyCallButton phoneNumber="+1-800-555-0100" label="Emergency Vet" />
 * ```
 */
const meta: Meta<typeof EmergencyCallButton> = {
  title: 'Components/EmergencyCallButton',
  component: EmergencyCallButton,
  decorators: [
    (Story) => (
      <View style={{ padding: 24, backgroundColor: '#fff' }}>
        <Story />
      </View>
    ),
  ],
  argTypes: {
    phoneNumber: { control: 'text' },
    label: { control: 'text' },
    skipConfirm: { control: 'boolean' },
    compact: { control: 'boolean' },
  },
};

export default meta;

type Story = StoryObj<typeof EmergencyCallButton>;

/** Default full-size button with a label and phone number. */
export const Default: Story = {
  args: {
    phoneNumber: '+1-800-555-0100',
    label: 'Emergency Vet',
    skipConfirm: false,
    compact: false,
  },
};

/** No label — shows only the phone number. */
export const NumberOnly: Story = {
  args: {
    phoneNumber: '+1-800-555-0100',
    skipConfirm: false,
    compact: false,
  },
};

/**
 * Compact mode renders a small 40×40 icon-only button.
 * Useful in tight layouts like list rows or cards.
 */
export const Compact: Story = {
  args: {
    phoneNumber: '+1-800-555-0100',
    label: 'Vet',
    compact: true,
  },
};

/**
 * `skipConfirm=true` bypasses the confirmation dialog and dials immediately.
 * Use for one-tap emergency scenarios where speed matters.
 */
export const SkipConfirm: Story = {
  args: {
    phoneNumber: '911',
    label: 'Emergency Services',
    skipConfirm: true,
  },
};
