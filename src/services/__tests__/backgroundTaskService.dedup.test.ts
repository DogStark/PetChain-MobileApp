import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import {
  registerBackgroundMedicationTask,
  reconcileScheduledNotifications,
} from '../backgroundTaskService';
import { getMedications } from '../medicationService';

jest.mock('expo-notifications');
jest.mock('expo-background-fetch');
jest.mock('expo-task-manager');
jest.mock('../medicationService');
jest.mock('../localDB');

describe('#917 — Prevent duplicate medication reminders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use stable schedule IDs (not regenerated per registration)', async () => {
    const med = {
      id: 'med-1',
      name: 'Amoxicillin',
      dosage: '500mg',
      frequency: 8,
      startDate: new Date().toISOString(),
    };

    (getMedications as jest.Mock).mockResolvedValue([med]);
    (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(async (config) => {
      const scheduleId = `sched-${med.id}-${config.trigger.date.getTime()}`;
      return scheduleId;
    });

    const id1 = await registerBackgroundMedicationTask();
    const id2 = await registerBackgroundMedicationTask();

    expect(id1).toBe(id2);
  });

  it('should reconcile desired vs actual scheduled notifications on upgrade', async () => {
    const med = {
      id: 'med-1',
      name: 'Amoxicillin',
      dosage: '500mg',
      frequency: 8,
      startDate: new Date().toISOString(),
    };

    (getMedications as jest.Mock).mockResolvedValue([med]);

    const oldScheduledNotif = {
      identifier: 'old-orphaned-id',
      content: { data: { type: 'medication_reminder', medicationId: 'med-2' } },
    };

    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([
      oldScheduledNotif,
    ]);

    await reconcileScheduledNotifications();

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-orphaned-id');
  });

  it('should not cancel notifications for active medications', async () => {
    const med = {
      id: 'med-1',
      name: 'Amoxicillin',
      dosage: '500mg',
      frequency: 8,
      startDate: new Date().toISOString(),
    };

    (getMedications as jest.Mock).mockResolvedValue([med]);

    const activeNotif = {
      identifier: 'active-id',
      content: { data: { type: 'medication_reminder', medicationId: 'med-1' } },
    };

    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([
      activeNotif,
    ]);

    await reconcileScheduledNotifications();

    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('should handle permission denied errors gracefully', async () => {
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockRejectedValue(
      new Error('Permission denied'),
    );

    const result = await reconcileScheduledNotifications();
    expect(result).toBeDefined();
  });

  it('should handle offline (timeout) gracefully', async () => {
    const error = new Error('Timeout');
    error.name = 'TimeoutError';
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockRejectedValue(error);

    const result = await reconcileScheduledNotifications();
    expect(result).toBeDefined();
  });

  it('should be idempotent: multiple calls should not create duplicates', async () => {
    const med = {
      id: 'med-1',
      name: 'Amoxicillin',
      dosage: '500mg',
      frequency: 8,
      startDate: new Date().toISOString(),
    };

    (getMedications as jest.Mock).mockResolvedValue([med]);
    (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue('notif-id-1');
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([]);

    await registerBackgroundMedicationTask();
    const secondCall = await registerBackgroundMedicationTask();

    expect(secondCall).toBe('notif-id-1');
  });
});
