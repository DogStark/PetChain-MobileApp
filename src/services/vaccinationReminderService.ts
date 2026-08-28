/**
 * Calculates upcoming vaccination due dates and schedules proactive reminders.
 */

export interface VaccinationRecord {
  id: string;
  petId: string;
  vaccineName: string;
  administeredDate: Date;
  /** How often this vaccine needs to be re-administered, in days. */
  intervalDays: number;
}

export interface UpcomingReminder {
  petId: string;
  vaccineName: string;
  dueDate: Date;
  /** Number of days remaining until the vaccine is due (negative if overdue). */
  daysUntilDue: number;
  isOverdue: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default lead times (in days before the due date) to send reminders. */
const DEFAULT_REMINDER_LEAD_DAYS = [14, 7, 1];

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Computes the next due date for a single vaccination record.
 */
export function calculateNextDueDate(record: VaccinationRecord): Date {
  return addDays(record.administeredDate, record.intervalDays);
}

/**
 * Builds the list of upcoming (or overdue) vaccination reminders for a set
 * of vaccination records, relative to `now`.
 */
export function getUpcomingReminders(
  records: VaccinationRecord[],
  now: Date = new Date()
): UpcomingReminder[] {
  return records
    .map((record) => {
      const dueDate = calculateNextDueDate(record);
      const daysUntilDue = daysBetween(now, dueDate);

      return {
        petId: record.petId,
        vaccineName: record.vaccineName,
        dueDate,
        daysUntilDue,
        isOverdue: daysUntilDue < 0,
      };
    })
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

export interface ScheduledReminder {
  petId: string;
  vaccineName: string;
  dueDate: Date;
  triggerDate: Date;
  leadDays: number;
}

/**
 * Schedules proactive reminder trigger dates for each upcoming vaccination,
 * based on a set of lead times (days before the due date).
 */
export function scheduleProactiveReminders(
  records: VaccinationRecord[],
  now: Date = new Date(),
  leadDays: number[] = DEFAULT_REMINDER_LEAD_DAYS
): ScheduledReminder[] {
  const upcoming = getUpcomingReminders(records, now).filter((r) => !r.isOverdue);
  const scheduled: ScheduledReminder[] = [];

  for (const reminder of upcoming) {
    for (const lead of leadDays) {
      const triggerDate = addDays(reminder.dueDate, -lead);
      if (triggerDate.getTime() >= now.getTime()) {
        scheduled.push({
          petId: reminder.petId,
          vaccineName: reminder.vaccineName,
          dueDate: reminder.dueDate,
          triggerDate,
          leadDays: lead,
        });
      }
    }
  }

  return scheduled.sort((a, b) => a.triggerDate.getTime() - b.triggerDate.getTime());
}
