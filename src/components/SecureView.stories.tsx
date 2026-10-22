import type { Meta, StoryObj } from '@storybook/react';
import { Text, View } from 'react-native';

import SecureView from './SecureView';

/**
 * `SecureView` — A drop-in `View` replacement that blocks screenshots and
 * screen recording on the wrapped content.
 *
 * Internally calls `useSecureScreen()` which applies platform-specific
 * screenshot prevention (FLAG_SECURE on Android, secure text field overlay
 * on iOS).
 *
 * Use this to wrap any screen or section that displays sensitive data such as
 * medical records, payment details, or personal information.
 *
 * ### Usage
 * ```tsx
 * // Wrap the root of a sensitive screen
 * <SecureView style={styles.container}>
 *   <MedicalRecordDetails record={record} />
 * </SecureView>
 * ```
 *
 * > **Note:** Screenshot prevention is a native feature. It has no visual
 * > effect inside Storybook's web/simulator preview.
 */
const meta: Meta<typeof SecureView> = {
  title: 'Components/SecureView',
  component: SecureView,
  decorators: [
    (Story) => (
      <View style={{ padding: 24, backgroundColor: '#fff' }}>
        <Story />
      </View>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof SecureView>;

/** Renders children normally — screenshot protection is active on device. */
export const Default: Story = {
  render: () => (
    <SecureView style={{ padding: 16, backgroundColor: '#f9f9f9', borderRadius: 8 }}>
      <Text style={{ fontSize: 14, color: '#333' }}>
        🔒 This content is protected from screenshots and screen recording.
      </Text>
    </SecureView>
  ),
};

/** Wrapping sensitive medical data. */
export const WithSensitiveContent: Story = {
  render: () => (
    <SecureView style={{ padding: 16, backgroundColor: '#fff3cd', borderRadius: 8 }}>
      <Text style={{ fontWeight: '700', marginBottom: 4 }}>Medical Record</Text>
      <Text style={{ fontSize: 13, color: '#555' }}>Diagnosis: Healthy</Text>
      <Text style={{ fontSize: 13, color: '#555' }}>Vet: Dr. Smith</Text>
      <Text style={{ fontSize: 13, color: '#555' }}>Date: 2025-01-15</Text>
    </SecureView>
  ),
};
