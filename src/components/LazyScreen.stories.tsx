import type { Meta, StoryObj } from '@storybook/react';
import { Text, View } from 'react-native';

import LazyScreen from './LazyScreen';

const meta: Meta<typeof LazyScreen> = {
  title: 'Components/LazyScreen',
  component: LazyScreen,
  decorators: [
    (Story) => (
      <View style={{ flex: 1, backgroundColor: '#ffffff', padding: 24 }}>
        <Story />
      </View>
    ),
  ],
  parameters: {
    notes:
      'Suspense wrapper for lazily loaded screen content. The fallback indicator is shown while children resolve.',
  },
};

export default meta;

type Story = StoryObj<typeof LazyScreen>;

export const Default: Story = {
  render: () => (
    <LazyScreen>
      <View style={{ padding: 24, backgroundColor: '#F3F4F6', borderRadius: 16 }}>
        <Text style={{ fontSize: 16, color: '#111827' }}>
          Lazy screen content has loaded successfully.
        </Text>
      </View>
    </LazyScreen>
  ),
};
