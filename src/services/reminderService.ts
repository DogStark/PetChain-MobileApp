import * as Notifications from 'expo-notifications';

export type SnoozeDuration = 15 | 60 | 120 | number;

export interface SnoozeRecord {
  reminderId: string;
  snoozedAt: number;
  durationMinutes: number;
}

export const reminderService = {
  async snooze(
    reminderId: string,
    durationMinutes: SnoozeDuration,
    nextDoseWindowMs?: number,
  ): Promise<Date> {
    const snoozeUntil = new Date(Date.now() + durationMinutes * 60 * 1000);

    if (nextDoseWindowMs && snoozeUntil.getTime() > nextDoseWindowMs) {
      throw new Error('Cannot snooze past next dose window');
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Medication Reminder',
        body: 'Time to take your medication',
        data: { reminderId, snoozed: true },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: snoozeUntil },
    });

    await fetch('/api/reminders/snooze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reminderId,
        durationMinutes,
        snoozeUntil: snoozeUntil.toISOString(),
      }),
    });

    return snoozeUntil;
  },

  async getSuggestedTime(reminderId: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/reminders/${reminderId}/suggested-time`);
      if (!res.ok) return null;

      const { suggestedHour } = (await res.json()) as { suggestedHour?: number | null };
      return typeof suggestedHour === 'number'
        ? `${String(suggestedHour).padStart(2, '0')}:00`
        : null;
    } catch {
      return null;
    }
  },
};
