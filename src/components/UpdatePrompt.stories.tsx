import { action } from '@storybook/addon-actions';
import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import UpdatePrompt from './UpdatePrompt';

const meta: Meta<typeof UpdatePrompt> = {
  title: 'Components/UpdatePrompt',
  component: UpdatePrompt,
  decorators: [
    (Story) => (
      <View style={{ flex: 1, backgroundColor: '#f9fafb', padding: 24 }}>
        <Story />
      </View>
    ),
  ],
  parameters: {
    notes: 'Modal prompt component for optional and forced updates with accessible action buttons.',
  },
};

export default meta;

type Story = StoryObj<typeof UpdatePrompt>;

export const OptionalUpdate: Story = {
  args: {
    visible: true,
    variant: 'optional',
    onUpdate: action('onUpdate'),
    onDismiss: action('onDismiss'),
  },
};

export const ForceUpdate: Story = {
  args: {
    visible: true,
    variant: 'force',
    storeUrl: 'https://example.com/update',
    onUpdate: action('onUpdate'),
  },
};
