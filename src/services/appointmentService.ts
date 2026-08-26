import { type AxiosResponse } from 'axios';

import apiClient from './apiClient';
import {
  getAllLocalAppointments,
  getAllAppointmentsByPetId,
  getAppointmentsInWindow,
  upsertAppointment,
  deleteAppointmentById,
} from './localDB';
import { AppointmentStatus } from '../models/Appointment';
import type { Appointment } from '../models/Appointment';
import type { Medication } from '../models/Medication';

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { Appointment } from '../models/Appointment';
export { AppointmentStatus } from '../models/Appointment';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = '/appointments';

/** Buffer window (ms) around each appointment that counts as a conflict */
export const CONFLICT_BUFFER_MS = 60 * 60 * 1000; // 1 hour

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppointmentConflict {
  type: 'appointment' | 'medication';
  description: string;
  conflictingAppointment?: Appointment;
  medicationName?: string;
  medicationTime?: Date;
}

export interface ConflictDetectionResult {
  hasConflicts: boolean;
  conflicts: AppointmentConflict[];
  suggestedTime?: Date;
}

export interface AvailabilityResult {
  vetId: string;
  date: string;
  availableSlots: string[];
}

// ─── Availability ─────────────────────────────────────────────────────────────

export async function getAvailability(vetId: string, date: string): Promise<AvailabilityResult> {
  const response: AxiosResponse<{ data: AvailabilityResult }> = await apiClient.get(
    `${BASE_URL}/availability`,
    { params: { vetId, date } },
  );
  return response.data.data;
}

// ─── Conflict Detection ───────────────────────────────────────────────────────

export async function detectConflicts(
  petId: string,
  proposedTime: Date,
  medications: Medication[] = [],
  excludeId?: string,
): Promise<ConflictDetectionResult> {
  const conflicts: AppointmentConflict[] = [];

  const windowStart = new Date(proposedTime.getTime() - CONFLICT_BUFFER_MS).toISOString();
  const windowEnd = new Date(proposedTime.getTime() + CONFLICT_BUFFER_MS).toISOString();

  const nearby = await getAppointmentsInWindow<Appointment>(petId, windowStart, windowEnd);
  for (const appt of nearby) {
    if (excludeId && appt.id === excludeId) continue;
    const apptTime = new Date(appt.date);
    const diffMs = Math.abs(apptTime.getTime() - proposedTime.getTime());
    if (diffMs <= CONFLICT_BUFFER_MS) {
      conflicts.push({
        type: 'appointment',
        description: `"${appt.title ?? 'Appointment'}" is scheduled ${_formatTimeDiff(diffMs)} from the proposed time.`,
        conflictingAppointment: appt,
      });
    }
  }

  const { getScheduleForRange } = await import('./medicationService');
  const windowStartDate = new Date(proposedTime.getTime() - CONFLICT_BUFFER_MS);
  const windowEndDate = new Date(proposedTime.getTime() + CONFLICT_BUFFER_MS);

  for (const med of medications) {
    if (!isVetSupervised(med)) continue;
    const doseTimes = getScheduleForRange(med, windowStartDate, windowEndDate);
    for (const doseTime of doseTimes) {
      const diffMs = Math.abs(doseTime.getTime() - proposedTime.getTime());
      if (diffMs <= CONFLICT_BUFFER_MS) {
        conflicts.push({
          type: 'medication',
          description: `"${med.name}" requires vet supervision at ${_formatTime(doseTime)} (within ${_formatTimeDiff(diffMs)} of the proposed time).`,
          medicationName: med.name,
          medicationTime: doseTime,
        });
      }
    }
  }

  const hasConflicts = conflicts.length > 0;
  const suggestedTime = hasConflicts
    ? await findNextAvailableSlot(petId, proposedTime, medications)
    : undefined;

  return { hasConflicts, conflicts, suggestedTime };
}

export function isVetSupervised(med: Medication): boolean {
  const haystack = [med.instructions ?? '', med.notes ?? ''].join(' ').toLowerCase();
  return (
    haystack.includes('vet') ||
    haystack.includes('supervis') ||
    haystack.includes('injection') ||
    haystack.includes('infusion') ||
    haystack.includes('administered by')
  );
}

export async function findNextAvailableSlot(
  petId: string,
  from: Date,
  medications: Medication[] = [],
): Promise<Date | undefined> {
  const MAX_ITERATIONS = 14 * 24;
  let candidate = new Date(from.getTime() + CONFLICT_BUFFER_MS);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const result = await detectConflicts(petId, candidate, medications);
    if (!result.hasConflicts) return candidate;
    candidate = new Date(candidate.getTime() + CONFLICT_BUFFER_MS);
  }
  return undefined;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getAppointments(petId?: string): Promise<Appointment[]> {
  if (petId) return getUpcomingAppointments(petId);

  try {
    const response: AxiosResponse<{ data: Appointment[] }> = await apiClient.get(BASE_URL);
    const remoteAppts = response.data.data;
    await Promise.all(remoteAppts.map((a) => upsertAppointment(a)));
    return remoteAppts;
  } catch {
    return getAllLocalAppointments<Appointment>();
  }
}

export async function getUpcomingAppointments(petId: string): Promise<Appointment[]> {
  try {
    const response: AxiosResponse<{ data: Appointment[] }> = await apiClient.get(
      `${BASE_URL}?petId=${petId}`,
    );
    const now = new Date();
    const upcoming = response.data.data
      .filter((a) => new Date(`${a.date}T${a.time}`) >= now)
      .sort(
        (a, b) =>
          new Date(`${a.date}T${a.time}`).getTime() - new Date(`${b.date}T${b.time}`).getTime(),
      );
    await Promise.all(upcoming.map((a) => upsertAppointment(a)));
    return upcoming;
  } catch {
    const local = await getAllAppointmentsByPetId<Appointment>(petId);
    const now = new Date();
    return local
      .filter((a) => new Date(a.date) >= now && a.status !== AppointmentStatus.CANCELLED)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }
}

export function getUpcoming(appointments: Appointment[]): Appointment[] {
  const now = new Date();
  return appointments
    .filter((a) => {
      const d = new Date(a.date);
      return (
        d >= now && a.status !== AppointmentStatus.CANCELLED && (a.status as string) !== 'cancelled'
      );
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function getPast(appointments: Appointment[]): Appointment[] {
  const now = new Date();
  return appointments
    .filter((a) => {
      const d = new Date(a.date);
      return (
        d < now || a.status === AppointmentStatus.CANCELLED || (a.status as string) === 'cancelled'
      );
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function saveAppointment(
  appointment: Omit<Appointment, 'id'> & { id?: string },
  conflictResolutionNote?: string,
): Promise<Appointment> {
  const appt = { ...appointment } as Appointment;
  if (conflictResolutionNote) {
    appt.notes = appt.notes
      ? `${appt.notes}\n\n[Conflict resolution]: ${conflictResolutionNote}`
      : `[Conflict resolution]: ${conflictResolutionNote}`;
  }

  if (appt.id) {
    await upsertAppointment(appt);
  }

  try {
    if (appt.id) {
      const response = await apiClient.put<{ data: Appointment }>(`${BASE_URL}/${appt.id}`, appt);
      const saved = response.data.data;
      await upsertAppointment(saved);
      return saved;
    }
    const response = await apiClient.post<{ data: Appointment }>(BASE_URL, appt);
    const saved = response.data.data;
    await upsertAppointment(saved);
    return saved;
  } catch {
    return appt;
  }
}

/** Cancel an appointment via the dedicated cancel endpoint. */
export async function cancelAppointmentById(id: string, reason?: string): Promise<Appointment> {
  try {
    const response = await apiClient.post<{ data: Appointment }>(`${BASE_URL}/${id}/cancel`, {
      reason,
    });
    const cancelled = response.data.data;
    await upsertAppointment(cancelled);
    return cancelled;
  } catch {
    // Offline: update locally
    const local = (await getAllLocalAppointments<Appointment>()).find((a) => a.id === id);
    if (local) {
      const updated = { ...local, status: AppointmentStatus.CANCELLED, cancellationReason: reason };
      await upsertAppointment(updated);
      return updated;
    }
    throw new Error('Appointment not found');
  }
}

/** Reschedule an appointment via the dedicated reschedule endpoint. */
export async function rescheduleAppointment(
  id: string,
  date: string,
  time: string,
  durationMinutes?: number,
): Promise<Appointment> {
  try {
    const response = await apiClient.post<{ data: Appointment }>(`${BASE_URL}/${id}/reschedule`, {
      date,
      time,
      durationMinutes,
    });
    const rescheduled = response.data.data;
    await upsertAppointment(rescheduled);
    return rescheduled;
  } catch {
    const local = (await getAllLocalAppointments<Appointment>()).find((a) => a.id === id);
    if (local) {
      const updated = {
        ...local,
        date,
        time,
        ...(durationMinutes !== undefined ? { durationMinutes } : {}),
        status: AppointmentStatus.RESCHEDULED,
        rescheduledFrom: `${local.date}T${local.time}`,
      };
      await upsertAppointment(updated);
      return updated;
    }
    throw new Error('Appointment not found');
  }
}

export async function deleteAppointment(id: string): Promise<void> {
  await deleteAppointmentById(id);
  try {
    await apiClient.delete(`${BASE_URL}/${id}`);
  } catch {
    // Offline: deletion already happened locally
  }
}

// ─── Notification helpers ─────────────────────────────────────────────────────

/**
 * Schedule 24h and 1h reminder notifications for an appointment.
 * Returns [notifId24h, notifId1h] — either may be null if scheduling failed
 * (e.g. appointment is too soon or in the past).
 */
export async function scheduleAppointmentReminders(
  appointment: Appointment,
): Promise<[string | null, string | null]> {
  const { scheduleAppointmentNotification } = await import('./notificationService');

  const apptMs = new Date(`${appointment.date}T${appointment.time ?? '00:00'}:00`).getTime();
  const now = Date.now();

  const title = appointment.title ?? appointment.notes ?? 'Vet Appointment';

  const notif24h =
    apptMs - 24 * 60 * 60 * 1000 > now
      ? await scheduleAppointmentNotification({
          id: `${appointment.id}-24h`,
          title: `Reminder: ${title} tomorrow`,
          date: new Date(apptMs - 24 * 60 * 60 * 1000).toISOString(),
          location: appointment.location,
        }).catch(() => null)
      : null;

  const notif1h =
    apptMs - 60 * 60 * 1000 > now
      ? await scheduleAppointmentNotification({
          id: `${appointment.id}-1h`,
          title: `Reminder: ${title} in 1 hour`,
          date: new Date(apptMs - 60 * 60 * 1000).toISOString(),
          location: appointment.location,
        }).catch(() => null)
      : null;

  return [notif24h, notif1h];
}

/** Legacy single-reminder helper (kept for backward compatibility). */
export async function scheduleAppointmentReminder(
  appointment: Appointment,
): Promise<string | null> {
  const [notif24h] = await scheduleAppointmentReminders(appointment);
  return notif24h;
}

export async function cancelAppointmentReminder(notificationId: string): Promise<void> {
  const { cancelEntityNotification } = await import('./notificationService');
  return cancelEntityNotification(notificationId);
}

/** Cancel all reminders for an appointment (both 24h and 1h). */
export async function cancelAllAppointmentReminders(appointmentId: string): Promise<void> {
  const { cancelEntityNotification } = await import('./notificationService');
  await Promise.allSettled([
    cancelEntityNotification(`${appointmentId}-24h`),
    cancelEntityNotification(`${appointmentId}-1h`),
    cancelEntityNotification(appointmentId), // legacy single-id
  ]);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _formatTimeDiff(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(ms / 3_600_000);
  return `${hrs} hr`;
}

function _formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export interface ConflictCheckResponse {
  conflicts: Array<{
    type: 'exact' | 'near';
    appointment: Appointment;
  }>;
  canSave: boolean;
  hasWarning: boolean;
  reason?: string;
}

/**
 * Check for appointment conflicts for a pet and vet at a given time.
 * @param petId - Pet ID
 * @param vetId - Vet ID
 * @param date - Date in YYYY-MM-DD format
 * @param time - Time in HH:MM format
 * @param durationMinutes - Appointment duration (default 30)
 * @param excludeId - Appointment ID to exclude from conflicts (for updates)
 */
export async function checkConflicts(
  petId: string,
  vetId: string,
  date: string,
  time: string,
  durationMinutes: number = 30,
  excludeId?: string,
): Promise<ConflictCheckResponse> {
  try {
    const response = await apiClient.post<{ data: ConflictCheckResponse }>(
      `${BASE_URL}/check-conflicts`,
      {
        petId,
        vetId,
        date,
        time,
        durationMinutes,
        excludeId,
      },
    );
    return response.data.data;
  } catch (error) {
    console.error('Failed to check conflicts:', error);
    // Return safe defaults on error - allow booking but log
    return {
      conflicts: [],
      canSave: true,
      hasWarning: false,
      reason: null,
    };
  }
}

// ─── Slot-conflict-safe booking (issue #961) ─────────────────────────────────

/**
 * Fields the user typed that are safe to carry back into the form after a slot
 * conflict — never the (now-invalid) date/time, never anything server-assigned.
 */
export type PreservableBookingInput = Pick<
  Appointment,
  'petId' | 'title' | 'location' | 'vetName' | 'notes' | 'durationMinutes'
> & { vetId?: string };

export interface BookAppointmentRequest extends PreservableBookingInput {
  /** Requested slot, `YYYY-MM-DD`. */
  date: string;
  /** Requested slot, `HH:mm`. */
  time: string;
  vetId: string;
  /**
   * Stable key identifying this booking attempt. Re-sent verbatim on retry so
   * the server can dedupe and never create two appointments for one intent.
   */
  idempotencyKey: string;
}

export type BookAppointmentResult =
  | { status: 'booked'; appointment: Appointment }
  | {
      status: 'conflict';
      /** Fresh alternative slots (`HH:mm`) for the same vet/date, if any. */
      alternatives: string[];
      /** The user's inputs minus the conflicted slot, ready to re-seed the form. */
      preservedInput: PreservableBookingInput & { date: string };
      message: string;
    };

function pickPreservable(req: BookAppointmentRequest): PreservableBookingInput {
  const { petId, title, location, vetName, notes, durationMinutes, vetId } = req;
  return { petId, title, location, vetName, notes, durationMinutes, vetId };
}

function httpStatusOf(error: unknown): number | undefined {
  const resp = (error as { response?: { status?: number } })?.response;
  return typeof resp?.status === 'number' ? resp.status : undefined;
}

/**
 * Book an appointment, tolerating the slot being taken between selection and
 * submit:
 *  - On HTTP 409 the form state is preserved (minus the dead slot) and a fresh
 *    list of alternative slots is fetched so the user can re-pick in place.
 *  - The caller-supplied `idempotencyKey` is sent as a header so a retry of the
 *    same intent can never double-book.
 *
 * Throws for non-409 errors so existing error handling still applies.
 */
export async function bookAppointmentWithConflictHandling(
  req: BookAppointmentRequest,
): Promise<BookAppointmentResult> {
  try {
    const response = await apiClient.post<{ data: Appointment }>(
      BASE_URL,
      {
        petId: req.petId,
        vetId: req.vetId,
        date: req.date,
        time: req.time,
        durationMinutes: req.durationMinutes,
        title: req.title,
        location: req.location,
        vetName: req.vetName,
        notes: req.notes,
      },
      { headers: { 'Idempotency-Key': req.idempotencyKey } },
    );
    const appointment = response.data.data;
    await upsertAppointment(appointment);
    return { status: 'booked', appointment };
  } catch (error) {
    if (httpStatusOf(error) !== 409) throw error;

    let alternatives: string[] = [];
    try {
      const availability = await getAvailability(req.vetId, req.date);
      alternatives = (availability.availableSlots ?? []).filter((slot) => slot !== req.time);
    } catch {
      alternatives = [];
    }

    return {
      status: 'conflict',
      alternatives,
      preservedInput: { ...pickPreservable(req), date: req.date },
      message:
        'That time was just booked by someone else. Your details are saved — pick another slot below.',
    };
  }
}
