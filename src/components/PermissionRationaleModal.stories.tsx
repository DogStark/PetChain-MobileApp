import { action } from '@storybook/addon-actions';
import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import PermissionRationaleModal from './PermissionRationaleModal';

/**
 * `PermissionRationaleModal` — A modal that explains why a permission is
 * needed before the system prompt appears, improving grant rates.
 *
 * Reads rationale copy (icon, title, description, benefits) from
 * `PERMISSION_RATIONALES` keyed by `permissionType`.
 *
 * ### Props
 * | Prop | Type | Default | Description |
 * |------|------|---------|-------------|
 * | `visible` | `boolean` | — | Controls modal visibility |
 * | `permissionType` | `PermissionType` | — | Which permission to explain |
 * | `onAllow` | `() => void` | — | Called when user taps "Allow" |
 * | `onDeny` | `() => void` | — | Called when user taps "Not Now" |
 * | `showSettings` | `boolean` | `false` | Show "Open Settings" instead of "Allow" |
 *
 * ### Usage
 * ```tsx
 * <PermissionRationaleModal
 *   visible={showModal}
 *   permissionType="camera"
 *   onAllow={requestCameraPermission}
 *   onDeny={() => setShowModal(false)}
 * />
 * ```
 */
const meta: Meta<typeof PermissionRationaleModal> = {
  title: 'Components/PermissionRationaleModal',
  component: PermissionRationaleModal,
  decorators: [
    (Story) => (
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' }}>
        <Story />
      </View>
    ),
  ],
  argTypes: {
    visible: { control: 'boolean' },
    permissionType: {
      control: 'select',
      options: ['camera', 'location', 'notifications', 'photoLibrary'],
    },
    showSettings: { control: 'boolean' },
  },
};

export default meta;

type Story = StoryObj<typeof PermissionRationaleModal>;

/** Camera permission rationale — shown before QR scan. */
export const Camera: Story = {
  args: {
    visible: true,
    permissionType: 'camera',
    onAllow: action('onAllow'),
    onDeny: action('onDeny'),
    showSettings: false,
  },
};

/** Location permission rationale — shown before Emergency SOS. */
export const Location: Story = {
  args: {
    visible: true,
    permissionType: 'location',
    onAllow: action('onAllow'),
    onDeny: action('onDeny'),
    showSettings: false,
  },
};

/**
 * `showSettings=true` replaces the "Allow" button with "Open Settings".
 * Use when the permission was previously denied and must be re-enabled manually.
 */
export const OpenSettings: Story = {
  args: {
    visible: true,
    permissionType: 'camera',
    onAllow: action('onAllow'),
    onDeny: action('onDeny'),
    showSettings: true,
  },
};

/** Hidden state — modal is not visible. */
export const Hidden: Story = {
  args: {
    visible: false,
    permissionType: 'camera',
    onAllow: action('onAllow'),
    onDeny: action('onDeny'),
  },
};
