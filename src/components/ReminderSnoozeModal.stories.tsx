import { action } from '@storybook/addon-actions';
import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import ReminderSnoozeModal from './ReminderSnoozeModal';
import { reminderService } from '../services/reminderService';

reminderService.getSuggestedTime = async () => '09:00';
reminderService.snooze = async (_, minutes) => new Date(Date.now() + minutes * 60 * 1000);

const meta: Meta<typeof ReminderSnoozeModal> = {
  title: 'Components/ReminderSnoozeModal',
  component: ReminderSnoozeModal,
  decorators: [
    (Story) => (
      <View style={{ flex: 1, backgroundColor: '#f3f4f6', padding: 24 }}>
        <Story />
      </View>
    ),
  ],
  parameters: {
    notes:
      'Modal prompt for snoozing medication reminders with accessible button roles and hint text.',
  },
};

export default meta;

type Story = StoryObj<typeof ReminderSnoozeModal>;

export const Default: Story = {
  args: {
    visible: true,
    reminderId: 'storybook-reminder-001',
    nextDoseWindowMs: Date.now() + 3 * 60 * 60 * 1000,
    onDismiss: action('onDismiss'),
    onSnoozed: action('onSnoozed'),
  },
};
