/*
 * Supported medication frequency values used by the backend API.
 */
export enum MedicationFrequency {
  ONCE_DAILY = 'once_daily',
  TWICE_DAILY = 'twice_daily',
  THREE_TIMES_DAILY = 'three_times_daily',
  EVERY_OTHER_DAY = 'every_other_day',
  WEEKLY = 'weekly',
  AS_NEEDED = 'as_needed',
}

/**
 * Medication lifecycle states used for tracking active and historical plans.
 */
export enum MedicationStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  DISCONTINUED = 'discontinued',
}

/**
 * Outcome of a scheduled medication administration event.
 */
export enum MedicationAdministrationOutcome {
  FULL = 'full',
  PARTIAL = 'partial',
  REFUSED = 'refused',
  NOT_GIVEN = 'not_given',
}

/**
 * Who recorded the administration outcome.
 */
export interface MedicationAdministrationActor {
  id: string;
  displayName?: string;
  role?: 'owner' | 'veterinarian' | 'caregiver' | 'system';
}

/**
 * Core medication model returned by backend APIs.
 */
export interface Medication {
  id: string;
  petId: string;
  name: string;
  dosage: string;
  frequency: MedicationFrequency;
  durationDays: number;
  startDate: string;
  endDate?: string;
  status: MedicationStatus;
  instructions?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload used to create a new medication schedule.
 */
export interface CreateMedicationInput {
  petId: string;
  name: string;
  dosage: string;
  frequency: MedicationFrequency;
  durationDays: number;
  startDate: string;
  endDate?: string;
  status?: MedicationStatus;
  instructions?: string;
}

/**
 * Payload used to update editable medication fields.
 */
export interface UpdateMedicationInput {
  name?: string;
  dosage?: string;
  frequency?: MedicationFrequency;
  durationDays?: number;
  startDate?: string;
  endDate?: string;
  status?: MedicationStatus;
  instructions?: string;
}

/**
 * A scheduled dose event for a medication plan. The original schedule is
 * preserved even when an administration outcome is recorded against it.
 */
export interface MedicationScheduledDoseEvent {
  id: string;
  medicationId: string;
  petId: string;
  scheduledAt: string;
  doseAmount?: string;
  createdAt: string;
}

/**
 * Recorded outcome for a scheduled dose event. Optional reason and actor
 * are preserved for partial, refused, and not-given outcomes.
 */
export interface MedicationAdministration {
  id: string;
  scheduledDoseEventId: string;
  medicationId: string;
  petId: string;
  outcome: MedicationAdministrationOutcome;
  administeredAt: string;
  administeredDose?: string;
  reason?: string;
  actor?: MedicationAdministrationActor;
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload used to record an administration outcome against a scheduled
 * dose event. The scheduled event is referenced by id and never mutated.
 */
export interface RecordMedicationAdministrationInput {
  scheduledDoseEventId: string;
  outcome: MedicationAdministrationOutcome;
  administeredAt?: string;
  administeredDose?: string;
  reason?: string;
  actor?: MedicationAdministrationActor;
  // Optional client-generated idempotency key for offline retry safety.
  clientRequestId?: string;
}
