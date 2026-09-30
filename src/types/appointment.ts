/**
 * Appointment domain types.
 *
 * Timezone handling for recurring reminders:
 * - `timezone` is the IANA timezone the appointment was created in (event timezone).
 *   It is persisted so existing appointments retain their original timezone even
 *   when the device timezone changes (travel, locale changes).
 * - `recurrence` describes the recurrence rule in terms of the event timezone.
 *   Occurrences must be calculated with a timezone-aware library (e.g. Luxon,
 *   date-fns-tz, Temporal) rather than device-local arithmetic.
 *
 * Deterministic behavior for DST transitions:
 * - Gap (skipped local time, e.g. 02:30 during spring-forward): the occurrence
 *   fires at the first valid instant after the gap (`gapBehavior: 'shift-forward'`).
 * - Overlap (repeated local time, e.g. 01:30 during fall-back): the occurrence
 *   fires once, at the first (earlier) instant (`overlapBehavior: 'first'`).
 * These defaults keep next-fire times deterministic across devices.
 */

export type AppointmentTimezone = string;

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type DstGapBehavior = 'shift-forward' | 'skip';
export type DstOverlapBehavior = 'first' | 'second';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** Interval between occurrences, e.g. every 2 weeks. Defaults to 1. */
  interval?: number;
  /** Days of week for weekly recurrences (0 = Sunday .. 6 = Saturday). */
  byWeekday?: number[];
  /** Inclusive end date (ISO 8601) after which no further occurrences fire. */
  until?: string;
  /** Number of occurrences, mutually exclusive with `until`. */
  count?: number;
  /** Behavior when a local time falls in a DST gap. Defaults to 'shift-forward'. */
  gapBehavior?: DstGapBehavior;
  /** Behavior when a local time falls in a DST overlap. Defaults to 'first'. */
  overlapBehavior?: DstOverlapBehavior;
}

export interface AppointmentReminder {
  /** Minutes before the occurrence to fire the reminder. */
  minutesBefore: number;
  /** Whether the reminder is currently enabled. */
  enabled: boolean;
}

export interface Appointment {
  id: string;
  title: string;
  /** Start time as an ISO 8601 instant (UTC). */
  startsAt: string;
  /** IANA timezone the appointment was created in (event timezone). */
  timezone: AppointmentTimezone;
  /** Recurrence rule, if the appointment repeats. */
  recurrence?: RecurrenceRule;
  reminders?: AppointmentReminder[];
}

/**
 * Serialized shape persisted on the server. Kept compatible with the mobile
 * `Appointment` type so existing records without `timezone`/`recurrence` still
 * deserialize; callers should fall back to the device timezone only when
 * `timezone` is absent (legacy records).
 */
export interface AppointmentDTO {
  id: string;
  title: string;
  starts_at: string;
  timezone?: AppointmentTimezone;
  recurrence?: RecurrenceRule;
  reminders?: AppointmentReminder[];
}

export function appointmentFromDTO(dto: AppointmentDTO, fallbackTimezone: AppointmentTimezone): Appointment {
  return {
    id: dto.id,
    title: dto.title,
    startsAt: dto.starts_at,
    timezone: dto.timezone ?? fallbackTimezone,
    recurrence: dto.recurrence,
    reminders: dto.reminders,
  };
}

export function appointmentToDTO(appointment: Appointment): AppointmentDTO {
  return {
    id: appointment.id,
    title: appointment.title,
    starts_at: appointment.startsAt,
    timezone: appointment.timezone,
    recurrence: appointment.recurrence,
    reminders: appointment.reminders,
  };
}
