import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import {
  BACKGROUND_MEDICATION_TASK,
  cancelMedicationNotifications,
  registerBackgroundMedicationTask,
  rescheduleUpcomingMedications,
  scheduleMedicationNotification,
  unregisterBackgroundMedicationTask,
} from '../../services/backgroundTaskService';
import * as medicationService from '../../services/medicationService';

jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: { NewData: 'newData', NoData: 'noData', Failed: 'failed' },
  registerTaskAsync: jest.fn(),
  unregisterTaskAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id-1'),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

jest.mock('../../services/medicationService', () => ({
  getMedications: jest.fn(),
  getScheduleForRange: jest.fn(),
}));

jest.mock('../../utils/errorLogger', () => ({ logError: jest.fn() }));

const mockMedication = {
  id: 'med-1',
  name: 'Amoxicillin',
  dosage: '250mg',
  frequency: 8,
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  status: 'active',
};

describe('backgroundTaskService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('registerBackgroundMedicationTask', () => {
    it('registers the task when not already registered', async () => {
      (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValue(false);
      await registerBackgroundMedicationTask();
      expect(BackgroundFetch.registerTaskAsync).toHaveBeenCalledWith(
        BACKGROUND_MEDICATION_TASK,
        expect.objectContaining({ stopOnTerminate: false, startOnBoot: true }),
      );
    });

    it('skips registration when task is already registered', async () => {
      (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValue(true);
      await registerBackgroundMedicationTask();
      expect(BackgroundFetch.registerTaskAsync).not.toHaveBeenCalled();
    });
  });

  describe('unregisterBackgroundMedicationTask', () => {
    it('unregisters when task is registered', async () => {
      (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValue(true);
      await unregisterBackgroundMedicationTask();
      expect(BackgroundFetch.unregisterTaskAsync).toHaveBeenCalledWith(BACKGROUND_MEDICATION_TASK);
    });

    it('does nothing when task is not registered', async () => {
      (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValue(false);
      await unregisterBackgroundMedicationTask();
      expect(BackgroundFetch.unregisterTaskAsync).not.toHaveBeenCalled();
    });
  });

  describe('rescheduleUpcomingMedications', () => {
    it('returns 0 when there are no medications', async () => {
      (medicationService.getMedications as jest.Mock).mockResolvedValue([]);
      const count = await rescheduleUpcomingMedications();
      expect(count).toBe(0);
    });

    it('schedules notifications for upcoming doses', async () => {
      const futureTime = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
      (medicationService.getMedications as jest.Mock).mockResolvedValue([mockMedication]);
      (medicationService.getScheduleForRange as jest.Mock).mockReturnValue([futureTime]);

      const count = await rescheduleUpcomingMedications();
      expect(count).toBe(1);
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            data: expect.objectContaining({ type: 'medication_reminder', medicationId: 'med-1' }),
          }),
        }),
      );
    });

    it('skips past dose times', async () => {
      const pastTime = new Date(Date.now() - 60 * 1000); // 1 minute ago
      (medicationService.getMedications as jest.Mock).mockResolvedValue([mockMedication]);
      (medicationService.getScheduleForRange as jest.Mock).mockReturnValue([pastTime]);

      const count = await rescheduleUpcomingMedications();
      expect(count).toBe(0);
      expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('cancels existing medication notifications before rescheduling', async () => {
      const existingNotif = {
        identifier: 'old-notif',
        content: { data: { type: 'medication_reminder' } },
      };
      (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([
        existingNotif,
      ]);
      (medicationService.getMedications as jest.Mock).mockResolvedValue([]);

      await rescheduleUpcomingMedications();
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-notif');
    });
  });

  describe('cancelMedicationNotifications', () => {
    it('cancels only medication_reminder notifications', async () => {
      const notifications = [
        { identifier: 'med-notif', content: { data: { type: 'medication_reminder' } } },
        { identifier: 'appt-notif', content: { data: { type: 'appointment' } } },
      ];
      (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue(
        notifications,
      );

      await cancelMedicationNotifications();
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('med-notif');
      expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('appt-notif');
    });
  });

  describe('scheduleMedicationNotification', () => {
    it('schedules a notification with correct content', async () => {
      const doseTime = new Date(Date.now() + 60 * 60 * 1000);
      await scheduleMedicationNotification(mockMedication as any, doseTime);

      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
        content: {
          title: '💊 Medication Reminder',
          body: `Time to give ${mockMedication.name} (${mockMedication.dosage})`,
          data: {
            type: 'medication_reminder',
            medicationId: mockMedication.id,
            scheduledFor: doseTime.toISOString(),
          },
        },
        trigger: { type: 'date', date: doseTime },
      });
    });
  });
});
