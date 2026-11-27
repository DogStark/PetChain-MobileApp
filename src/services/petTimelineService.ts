import { getAppointments } from './appointmentService';
import { getHealthMetrics } from './healthMetricService';
import { getMedicalRecords, type MedicalRecord } from './medicalRecordService';
import { getMedications } from './medicationService';
import { getVaccinationReminders } from './vaccinationService';
import type { Appointment } from '../models/Appointment';
import type { Medication } from '../models/Medication';

/** Number of timeline entries returned per page (issue #1376). */
export const TIMELINE_PAGE_SIZE = 20;

export type TimelineEntryType =
  | 'record'
  | 'medication'
  | 'appointment'
  | 'weight'
  | 'vaccination';

export interface TimelineEntry {
  /** Stable, type-prefixed identifier. */
  id: string;
  type: TimelineEntryType;
  /** ISO timestamp used for chronological sorting and date dividers. */
  occurredAt: string;
  title: string;
  subtitle?: string;
  /** Identifier of the underlying entity, used for navigation. */
  entityId: string;
}

export interface TimelinePage {
  entries: TimelineEntry[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

const toIso = (value?: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const recordTitle = (record: MedicalRecord): string => {
  const extended = record as MedicalRecord & { vaccineName?: string; treatmentName?: string };
  if (extended.vaccineName) return extended.vaccineName;
  if (extended.treatmentName) return extended.treatmentName;
  return record.type.charAt(0).toUpperCase() + record.type.slice(1);
};

const recordToEntry = (record: MedicalRecord): TimelineEntry | null => {
  const occurredAt = toIso(record.date) ?? toIso(record.createdAt);
  if (!occurredAt) return null;
  return {
    id: `record:${record.id}`,
    type: 'record',
    occurredAt,
    title: recordTitle(record),
    subtitle: record.veterinarian || record.notes || undefined,
    entityId: record.id,
  };
};

const medicationToEntry = (medication: Medication): TimelineEntry | null => {
  const occurredAt = toIso(medication.startDate) ?? toIso(medication.createdAt);
  if (!occurredAt) return null;
  return {
    id: `medication:${medication.id}`,
    type: 'medication',
    occurredAt,
    title: medication.name,
    subtitle: medication.dosage || undefined,
    entityId: medication.id,
  };
};

const appointmentToEntry = (appointment: Appointment): TimelineEntry | null => {
  const occurredAt = toIso(`${appointment.date}T${appointment.time || '00:00'}`);
  if (!occurredAt) return null;
  return {
    id: `appointment:${appointment.id}`,
    type: 'appointment',
    occurredAt,
    title: appointment.type ? `Appointment: ${appointment.type}` : 'Appointment',
    subtitle: appointment.vet?.name || appointment.notes || undefined,
    entityId: appointment.id,
  };
};

const weightToEntry = (metric: {
  id: string;
  recordedAt: string;
  weightKg?: number;
}): TimelineEntry | null => {
  if (typeof metric.weightKg !== 'number') return null;
  const occurredAt = toIso(metric.recordedAt);
  if (!occurredAt) return null;
  return {
    id: `weight:${metric.id}`,
    type: 'weight',
    occurredAt,
    title: `Weight: ${metric.weightKg} kg`,
    entityId: metric.id,
  };
};

const vaccinationToEntry = (reminder: {
  id: string;
  vaccineName: string;
  lastAdministeredDate?: string;
  dueDate: string;
}): TimelineEntry | null => {
  const occurredAt = toIso(reminder.lastAdministeredDate) ?? toIso(reminder.dueDate);
  if (!occurredAt) return null;
  return {
    id: `vaccination:${reminder.id}`,
    type: 'vaccination',
    occurredAt,
    title: reminder.vaccineName,
    subtitle: reminder.lastAdministeredDate ? 'Administered' : 'Due',
    entityId: reminder.id,
  };
};

const settle = async <T>(promise: Promise<T>): Promise<T | null> => {
  try {
    return await promise;
  } catch {
    return null;
  }
};

/**
 * Collects every health event for a pet from the local/remote sources and
 * returns them in a single chronologically sorted (newest first) feed.
 */
export async function getPetTimelineEntries(petId: string): Promise<TimelineEntry[]> {
  if (!petId) return [];

  const [records, medications, appointments, metrics, vaccinations] = await Promise.all([
    settle(getMedicalRecords(petId, { limit: 100 })),
    settle(getMedications()),
    settle(getAppointments(petId)),
    settle(getHealthMetrics(petId)),
    settle(getVaccinationReminders(petId)),
  ]);

  const entries: TimelineEntry[] = [];

  for (const record of records?.data.data ?? []) {
    const entry = recordToEntry(record);
    if (entry) entries.push(entry);
  }
  for (const medication of medications ?? []) {
    if (medication.petId !== petId) continue;
    const entry = medicationToEntry(medication);
    if (entry) entries.push(entry);
  }
  for (const appointment of appointments ?? []) {
    if (appointment.petId && appointment.petId !== petId) continue;
    const entry = appointmentToEntry(appointment);
    if (entry) entries.push(entry);
  }
  for (const metric of metrics ?? []) {
    const entry = weightToEntry(metric);
    if (entry) entries.push(entry);
  }
  for (const reminder of vaccinations ?? []) {
    const entry = vaccinationToEntry(reminder);
    if (entry) entries.push(entry);
  }

  return entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

/** Returns a single page of the pet timeline (20 entries per page). */
export async function getPetTimelinePage(
  petId: string,
  page = 1,
  pageSize = TIMELINE_PAGE_SIZE,
): Promise<TimelinePage> {
  const entries = await getPetTimelineEntries(petId);
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  const pageEntries = entries.slice(start, start + pageSize);
  return {
    entries: pageEntries,
    page: safePage,
    pageSize,
    total: entries.length,
    hasMore: start + pageSize < entries.length,
  };
}

export default { getPetTimelineEntries, getPetTimelinePage, TIMELINE_PAGE_SIZE };
