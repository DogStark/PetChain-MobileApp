/**
 * Background App Refresh for Medication Reminders
 *
 * Uses expo-background-fetch + expo-task-manager to re-schedule any missed
 * medication notifications after the app has been backgrounded or killed.
 */

import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { getMedications, getScheduleForRange, type Medication } from './medicationService';
import { logError } from '../utils/errorLogger';

export const BACKGROUND_MEDICATION_TASK = 'BACKGROUND_MEDICATION_REMINDER_TASK';

/** How far ahead (in hours) to pre-schedule notifications on each background wake. */
const SCHEDULE_HORIZON_HOURS = 24;

/** Minimum interval between background fetches (seconds). iOS enforces its own minimum (~15 min). */
const FETCH_INTERVAL_SECONDS = 15 * 60;

// ─── Task Definition ─────────────────────────────────────────────────────────

TaskManager.defineTask(BACKGROUND_MEDICATION_TASK, async () => {
  try {
    const rescheduled = await rescheduleUpcomingMedications();
    console.log(`[BackgroundTask] Rescheduled ${rescheduled} medication notifications`);
    return rescheduled > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (err) {
    logError(err as Error, { context: BACKGROUND_MEDICATION_TASK });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register the background fetch task. Call once on app startup (e.g. in App.tsx).
 * Safe to call multiple times — skips registration if already registered.
 */
export async function registerBackgroundMedicationTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_MEDICATION_TASK);
    if (isRegistered) return;

    await BackgroundFetch.registerTaskAsync(BACKGROUND_MEDICATION_TASK, {
      minimumInterval: FETCH_INTERVAL_SECONDS,
      stopOnTerminate: false, // continue after app is killed (Android)
      startOnBoot: true, // restart on device reboot (Android)
    });
    console.log('[BackgroundTask] Registered medication reminder task');
  } catch (err) {
    // Background fetch may be unavailable in Expo Go or certain simulators
    logError(err as Error, { context: 'registerBackgroundMedicationTask' });
  }
}

/**
 * Unregister the background fetch task (e.g. when user disables reminders).
 */
export async function unregisterBackgroundMedicationTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_MEDICATION_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_MEDICATION_TASK);
    }
  } catch (err) {
    logError(err as Error, { context: 'unregisterBackgroundMedicationTask' });
  }
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Cancel all pending medication notifications and re-schedule them for the
 * next SCHEDULE_HORIZON_HOURS window. Returns the number of notifications scheduled.
 */
export async function rescheduleUpcomingMedications(): Promise<number> {
  const medications = await getMedications();
  if (!medications.length) return 0;

  // Cancel existing scheduled medication notifications to avoid duplicates
  await cancelMedicationNotifications();

  const now = new Date();
  const horizon = new Date(now.getTime() + SCHEDULE_HORIZON_HOURS * 60 * 60 * 1000);

  let count = 0;
  for (const med of medications) {
    const doses = getScheduleForRange(med, now, horizon);
    for (const doseTime of doses) {
      if (doseTime <= now) continue; // skip already-past doses
      await scheduleMedicationNotification(med, doseTime);
      count++;
    }
  }

  return count;
}

/**
 * Cancel all currently scheduled medication reminder notifications.
 */
export async function cancelMedicationNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const medicationNotifications = scheduled.filter(
    (n) => (n.content.data as Record<string, unknown>)?.type === 'medication_reminder',
  );
  await Promise.all(
    medicationNotifications.map((n) =>
      Notifications.cancelScheduledNotificationAsync(n.identifier),
    ),
  );
}

/**
 * Schedule a single medication dose notification.
 */
export async function scheduleMedicationNotification(
  med: Medication,
  doseTime: Date,
): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: '💊 Medication Reminder',
      body: `Time to give ${med.name} (${med.dosage})`,
      data: {
        type: 'medication_reminder',
        medicationId: med.id,
        scheduledFor: doseTime.toISOString(),
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: doseTime,
    },
  });
}

// ─── Reconciliation (prevent duplicates on upgrade) ──────────────────────────

/**
 * Reconcile desired schedules (from current medication data) vs actual native schedules.
 * Cancels orphaned/obsolete notifications that remain from previous app versions.
 */
export async function reconcileScheduledNotifications(): Promise<number> {
  try {
    const medications = await getMedications();
    const activeMedicationIds = new Set(medications.map((m) => m.id));

    const allScheduled = await Notifications.getAllScheduledNotificationsAsync();
    const medicationNotifs = allScheduled.filter(
      (n) => (n.content.data as Record<string, unknown>)?.type === 'medication_reminder',
    );

    let cancelledCount = 0;
    for (const notif of medicationNotifs) {
      const medId = (notif.content.data as Record<string, unknown>)?.medicationId as string | undefined;
      if (medId && !activeMedicationIds.has(medId)) {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
        cancelledCount++;
      }
    }

    return cancelledCount;
  } catch (err) {
    logError(err as Error, { context: 'reconcileScheduledNotifications' });
    return 0;
  }
}
