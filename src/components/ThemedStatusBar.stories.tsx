import type { Meta, StoryObj } from '@storybook/react';
import { Text, View } from 'react-native';

import ThemedStatusBar from './ThemedStatusBar';

const meta: Meta<typeof ThemedStatusBar> = {
  title: 'Components/ThemedStatusBar',
  component: ThemedStatusBar,
  decorators: [
    (Story) => (
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <Story />
      </View>
    ),
  ],
  parameters: {
    notes: 'Status bar component that adapts bar style and background color to the current theme.',
  },
};

export default meta;

type Story = StoryObj<typeof ThemedStatusBar>;

export const Default: Story = {
  render: () => (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <ThemedStatusBar />
      <Text style={{ fontSize: 16, color: '#111827' }}>
        Current theme mode is applied to the status bar.
      </Text>
    </View>
  ),
};
