import { action } from '@storybook/addon-actions';
import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import SOSButton from './SOSButton';

/**
 * `SOSButton` — A hold-to-activate emergency SOS button with a 3-second
 * countdown and haptic feedback.
 *
 * Interaction flow:
 * 1. User **holds** the button for 1.5 seconds → progress bar fills
 * 2. Countdown (3 → 2 → 1) appears with a pulsing animation
 * 3. User can **tap** during countdown to cancel
 * 4. On completion, `emergencyService.triggerSOS()` is called
 *
 * ### Props
 * | Prop | Type | Default | Description |
 * |------|------|---------|-------------|
 * | `onSOSSent` | `() => void` | — | Callback fired after SOS is dispatched |
 * | `style` | `StyleProp<ViewStyle>` | — | Extra container style |
 *
 * ### Usage
 * ```tsx
 * <SOSButton onSOSSent={() => navigation.navigate('SOSConfirmation')} />
 * ```
 */
const meta: Meta<typeof SOSButton> = {
  title: 'Components/SOSButton',
  component: SOSButton,
  decorators: [
    (Story) => (
      <View style={{ padding: 24, backgroundColor: '#f5f5f5' }}>
        <Story />
      </View>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof SOSButton>;

/** Default idle state — shows "HOLD TO ACTIVATE" hint. */
export const Default: Story = {
  args: {
    onSOSSent: action('onSOSSent'),
  },
};

/** Custom container style — e.g. full-width with extra margin. */
export const FullWidth: Story = {
  args: {
    onSOSSent: action('onSOSSent'),
    style: { marginHorizontal: 0 },
  },
};
