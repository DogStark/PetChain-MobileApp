/**
 * Calculates upcoming vaccination due dates and schedules proactive reminders.
 */
import type { Species } from '../models/Pet';

import { reminderService } from './reminderService';

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

// ─── Age-based health milestones ──────────────────────────────────────────────

export type MilestoneType =
  | 'core_vaccination'
  | 'booster'
  | 'rabies'
  | 'dental_check'
  | 'senior_screening'
  | 'wellness_check';

export interface MilestoneDefinition {
  type: MilestoneType;
  label: string;
  /** Age (in months) at which the milestone is due. */
  ageMonths: number;
}

export interface HealthMilestone {
  /** Deterministic id: `${petId}:${type}:${ageMonths}`. */
  id: string;
  petId: string;
  petName: string;
  species: Species;
  type: MilestoneType;
  label: string;
  ageMonths: number;
  dueDate: Date;
}

export interface PetMilestoneInput {
  id: string;
  name: string;
  species: Species;
  dateOfBirth?: string | null;
}

/** Built-in milestone schedule per species. */
export const DEFAULT_MILESTONES: Record<Species, MilestoneDefinition[]> = {
  dog: [
    { type: 'core_vaccination', label: 'Core vaccinations (DHPP)', ageMonths: 2 },
    { type: 'booster', label: 'Booster vaccinations', ageMonths: 4 },
    { type: 'rabies', label: 'Rabies vaccination', ageMonths: 4 },
    { type: 'wellness_check', label: 'Annual wellness check', ageMonths: 12 },
    { type: 'dental_check', label: 'Dental check-up', ageMonths: 24 },
    { type: 'senior_screening', label: 'Senior health screening', ageMonths: 84 },
  ],
  cat: [
    { type: 'core_vaccination', label: 'Core vaccinations (FVRCP)', ageMonths: 2 },
    { type: 'booster', label: 'Booster vaccinations', ageMonths: 4 },
    { type: 'rabies', label: 'Rabies vaccination', ageMonths: 4 },
    { type: 'wellness_check', label: 'Annual wellness check', ageMonths: 12 },
    { type: 'dental_check', label: 'Dental check-up', ageMonths: 36 },
    { type: 'senior_screening', label: 'Senior health screening', ageMonths: 96 },
  ],
  rabbit: [
    { type: 'core_vaccination', label: 'Myxomatosis vaccination', ageMonths: 2 },
    { type: 'booster', label: 'RHDV booster', ageMonths: 4 },
    { type: 'dental_check', label: 'Dental check-up', ageMonths: 12 },
    { type: 'wellness_check', label: 'Annual wellness check', ageMonths: 12 },
    { type: 'senior_screening', label: 'Senior health screening', ageMonths: 60 },
  ],
  bird: [
    { type: 'wellness_check', label: 'Annual avian wellness check', ageMonths: 12 },
    { type: 'senior_screening', label: 'Senior health screening', ageMonths: 96 },
  ],
  other: [
    { type: 'wellness_check', label: 'Annual wellness check', ageMonths: 12 },
    { type: 'senior_screening', label: 'Senior health screening', ageMonths: 84 },
  ],
};

let milestoneConfig: Record<Species, MilestoneDefinition[]> = DEFAULT_MILESTONES;

/** Replace the milestone configuration for a species (e.g. from remote config). */
export function configureMilestones(species: Species, milestones: MilestoneDefinition[]): void {
  milestoneConfig = { ...milestoneConfig, [species]: milestones };
}

/** Reset all species configurations back to the built-in defaults. */
export function resetMilestoneConfig(): void {
  milestoneConfig = DEFAULT_MILESTONES;
}

export function getMilestonesForSpecies(species: Species): MilestoneDefinition[] {
  return milestoneConfig[species] ?? DEFAULT_MILESTONES.other;
}

/**
 * Parse a date-of-birth string. Returns null for missing or invalid values so
 * callers can skip pets with an unknown DOB instead of guessing.
 */
export function parseDateOfBirth(dateOfBirth?: string | null): Date | null {
  if (!dateOfBirth) return null;
  const parsed = new Date(dateOfBirth);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Add whole months to a date, clamping the day to the last day of the target
 * month (e.g. Jan 31 + 1 month = Feb 28/29) so leap years are handled.
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const targetDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const daysInTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(targetDay, daysInTargetMonth));
  return result;
}

/** Age in whole months, or null when the DOB is unknown/invalid. */
export function calculateAgeInMonths(
  dateOfBirth: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const dob = parseDateOfBirth(dateOfBirth);
  if (!dob) return null;
  let months = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
  if (now.getDate() < dob.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Calculate all milestone dates for a pet from its date of birth.
 * Returns an empty list when the DOB is unknown or invalid.
 */
export function calculateMilestones(
  pet: PetMilestoneInput,
  now: Date = new Date(),
): HealthMilestone[] {
  const dob = parseDateOfBirth(pet.dateOfBirth);
  if (!dob) return [];

  return getMilestonesForSpecies(pet.species).map((definition) => ({
    id: `${pet.id}:${definition.type}:${definition.ageMonths}`,
    petId: pet.id,
    petName: pet.name,
    species: pet.species,
    type: definition.type,
    label: definition.label,
    ageMonths: definition.ageMonths,
    dueDate: addMonths(dob, definition.ageMonths),
  }));
}

/** Milestones that are due on or after `now` (i.e. still upcoming). */
export function getUpcomingMilestones(
  pet: PetMilestoneInput,
  now: Date = new Date(),
): HealthMilestone[] {
  return calculateMilestones(pet, now).filter((m) => m.dueDate.getTime() >= now.getTime());
}

/**
 * Create reminders for a pet's upcoming health milestones via reminderService.
 * Idempotent: reminder ids are derived from pet, milestone type and age.
 */
export async function scheduleMilestoneReminders(
  pet: PetMilestoneInput,
  now: Date = new Date(),
): Promise<HealthMilestone[]> {
  const upcoming = getUpcomingMilestones(pet, now);

  await Promise.all(
    upcoming.map((milestone) =>
      reminderService.createReminder({
        id: `milestone:${milestone.id}`,
        title: `${pet.name}: ${milestone.label}`,
        body: `${milestone.label} is due for ${pet.name} on ${milestone.dueDate.toDateString()}.`,
        scheduledAt: milestone.dueDate.getTime(),
        metadata: {
          petId: milestone.petId,
          milestoneType: milestone.type,
          ageMonths: milestone.ageMonths,
          kind: 'health_milestone',
        },
      }),
    ),
  );

  return upcoming;
}

export const vaccinationReminderService = {
  calculateMilestones,
  getUpcomingMilestones,
  scheduleMilestoneReminders,
  calculateAgeInMonths,
  getMilestonesForSpecies,
  configureMilestones,
  resetMilestoneConfig,
};
