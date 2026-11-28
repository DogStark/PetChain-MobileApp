import * as Notifications from 'expo-notifications';

import apiClient from '../apiClient';
import { reminderService } from '../reminderService';

jest.mock('../apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const enabledPreferences = {
  data: { data: { enabled: true, topics: { medication_reminders: true } } },
};

describe('reminderService.snooze', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue('new-snooze');
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([]);
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockResolvedValue(undefined);
    (apiClient.get as jest.Mock).mockResolvedValue(enabledPreferences);
    (apiClient.post as jest.Mock).mockResolvedValue({ status: 200 });
  });

  it('confirms permissions and schedules a bounded snooze', async () => {
    const until = await reminderService.snooze('reminder-1', 60);

    expect(apiClient.get).toHaveBeenCalledWith('/api/notifications/preferences');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/reminders/snooze',
      expect.objectContaining({ reminderId: 'reminder-1', durationMinutes: 60 }),
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ data: expect.objectContaining({ reminderId: 'reminder-1' }) }),
        trigger: expect.objectContaining({ date: until }),
      }),
    );
  });

  it('does not schedule when the server has disabled care reminders', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      data: { data: { enabled: false, topics: { medication_reminders: true } } },
    });

    await expect(reminderService.snooze('reminder-1', 15)).rejects.toThrow(
      'Care reminders are turned off in your account settings',
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule when OS notifications are denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

    await expect(reminderService.snooze('reminder-1', 15)).rejects.toThrow(
      'Notifications are turned off for PetChain',
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('fails closed when the server returns unconfirmed settings', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ data: { data: {} } });

    await expect(reminderService.snooze('reminder-1', 15)).rejects.toThrow(
      'Notification settings could not be confirmed by the server',
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('rejects stale server denial without falling back to a local schedule', async () => {
    (apiClient.post as jest.Mock).mockRejectedValue(new Error('Request failed with status 403'));

    await expect(reminderService.snooze('reminder-1', 15)).rejects.toThrow(
      'Request failed with status 403',
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('preserves local snoozing while offline when OS permission is granted', async () => {
    (apiClient.get as jest.Mock).mockRejectedValue(new Error('Network Error'));

    await expect(reminderService.snooze('reminder-1', 15)).resolves.toBeInstanceOf(Date);
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('replaces an existing local snooze for the same reminder', async () => {
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([
      {
        identifier: 'old-snooze',
        content: { data: { reminderId: 'reminder-1', snoozed: true } },
      },
      {
        identifier: 'other-reminder',
        content: { data: { reminderId: 'reminder-2', snoozed: true } },
      },
    ]);

    await reminderService.snooze('reminder-1', 15);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-snooze');
  });

  it('rejects invalid durations and snoozes beyond the next dose', async () => {
    await expect(reminderService.snooze('reminder-1', 1441)).rejects.toThrow(/between 1 and 1440/);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    await expect(reminderService.snooze('reminder-1', 60, Date.now())).rejects.toThrow(
      'Cannot snooze past next dose window',
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('accepts the maximum 24-hour snooze interval', async () => {
    await expect(reminderService.snooze('reminder-1', 1440)).resolves.toBeInstanceOf(Date);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});