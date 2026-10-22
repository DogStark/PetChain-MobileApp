import * as Notifications from 'expo-notifications';

import {
  getAllMedications,
  upsertMedication,
  deleteMedicationById,
  getDoseLogs as dbGetDoseLogs,
  addDoseLog as dbAddDoseLog,
} from './localDB';
import type { Medication, RefillStatus } from '../models/Medication';

export type { Medication, RefillStatus };

/**
 * Explicit dose state machine (#1049).
 *
 * A scheduled dose moves through a small, well-defined set of states so a
 * reminder can never be silently dismissed and caregivers can always tell
 * whether follow-up is needed:
 *
 *   pending ──taken──▶ taken
 *      │  └──skipped──▶ skipped (optional reason)
 *      │  └──snoozed──▶ snoozed ──(snooze expires)──▶ pending
 *      └──(grace period expires)──▶ missed
 *
 * `missed` is only ever produced by {@link resolveDoseState} once the grace
 * period has elapsed — never by a user action — so a dose cannot be marked
 * missed before it is actually overdue.
 */
export type DoseState = 'pending' | 'taken' | 'skipped' | 'snoozed' | 'missed';

/** Default grace period before an unacknowledged dose becomes `missed`. */
export const DEFAULT_GRACE_PERIOD_MS = 30 * 60 * 1000;

/** Default snooze duration applied when a dose is snoozed. */
export const DEFAULT_SNOOZE_MS = 10 * 60 * 1000;

export interface DoseLog {
  id: string;
  medicationId: string;
  takenAt: string; // ISO string
  skipped?: boolean;
  scheduledFor?: string;
  notes?: string;
  /**
   * Stable identity for the scheduled dose this log fulfils. Derived from the
   * medication ID and the scheduled instant so the same dose resolves to the
   * same ID regardless of entry point (manual tap, notification action, or
   * offline-queue replay). Used to make dose logging idempotent.
   */
  scheduledDoseId?: string;
  /** Explicit state of the dose (#1049). Defaults to `taken` for legacy logs. */
  state?: DoseState;
  /** Optional free-text reason supplied when a dose is skipped (#1049). */
  skipReason?: string;
  /** Instant the dose was snoozed until, when `state === 'snoozed'` (#1049). */
  snoozedUntil?: string;
  /** Instant the dose was acknowledged (taken/skipped/snoozed) (#1049). */
  acknowledgedAt?: string;
}

export interface MedicationAdherence {
  scheduled: number;
  taken: number;
  skipped: number;
  missed: number;
  score: number;
}

// ── Medication schedule conflict detection (#1147) ───────────────────────────

/**
 * A single scheduled dose time for a medication, expressed as minutes since
 * local midnight. `endMinutes` is optional and only present when the entry
 * describes a time *range* (e.g. "take between 08:00 and 10:00").
 */
export interface DoseScheduleEntry {
  /** Minutes since local midnight for the start of the dose window. */
  startMinutes: number;
  /** Minutes since local midnight for the end of the window (inclusive). */
  endMinutes?: number;
}

/** A detected overlap between two dose schedule entries for the same medicine. */
export interface MedicationScheduleConflict {
  /** Index of the first conflicting entry in the input array. */
  firstIndex: number;
  /** Index of the second conflicting entry in the input array. */
  secondIndex: number;
  /** Human-readable reason, suitable for an accessibility announcement. */
  reason: 'duplicate-time' | 'overlapping-window';
}

/** Normalise a schedule entry into a closed [start, end] minute range. */
function toRange(entry: DoseScheduleEntry): { start: number; end: number } {
  const start = entry.startMinutes;
  const end = entry.endMinutes ?? entry.startMinutes;
  return start <= end ? { start, end } : { start: end, end: start };
}

/**
 * Detect overlapping dose schedules for the same medicine from entered data.
 *
 * Purely local and synchronous — no network dependency — so conflict warnings
 * keep working offline. Two entries conflict when their (inclusive) minute
 * ranges intersect; identical single times are reported as `duplicate-time`
 * so the UI can distinguish an accidental double entry from a genuine window
 * overlap.
 */
export function detectScheduleConflicts(
  entries: DoseScheduleEntry[],
): MedicationScheduleConflict[] {
  const conflicts: MedicationScheduleConflict[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const a = toRange(entries[i]);
    for (let j = i + 1; j < entries.length; j += 1) {
      const b = toRange(entries[j]);
      if (a.start <= b.end && b.start <= a.end) {
        const duplicate = a.start === a.end && b.start === b.end && a.start === b.start;
        conflicts.push({
          firstIndex: i,
          secondIndex: j,
          reason: duplicate ? 'duplicate-time' : 'overlapping-window',
        });
      }
    }
  }
  return conflicts;
}

/**
 * Persist a medication only after the caller has acknowledged any schedule
 * conflicts. When conflicts exist and `confirmed` is not `true`, the write is
 * blocked and the conflicts are returned so the UI can prompt the user.
 *
 * Conflict detection is local, so this preserves existing offline behaviour.
 */
export async function saveMedicationWithConflictCheck(
  med: Medication,
  entries: DoseScheduleEntry[],
  confirmed: boolean,
): Promise<{ saved: boolean; conflicts: MedicationScheduleConflict[] }> {
  const conflicts = detectScheduleConflicts(entries);
  if (conflicts.length > 0 && !confirmed) {
    return { saved: false, conflicts };
  }
  await upsertMedication(med);
  return { saved: true, conflicts };
}

export async function getMedications(): Promise<Medication[]> {
  return getAllMedications<Medication>();
}

export async function saveMedication(med: Medication): Promise<void> {
  await upsertMedication(med);
}

export async function deleteMedication(id: string): Promise<void> {
  await deleteMedicationById(id);
}

export async function getDoseLogs(): Promise<DoseLog[]> {
  return dbGetDoseLogs<DoseLog>();
}

export async function logDose(log: DoseLog): Promise<void> {
  await dbAddDoseLog(log);
}

// ── Idempotent dose logging (#958) ───────────────────────────────────────────

/**
 * Deterministic identity for a single scheduled dose.
 *
 * The same medication + scheduled instant always yields the same ID, so a dose
 * marked from a notification action, a manual tap, and a replayed offline-queue
 * entry all collapse onto one record instead of being counted 2–3 times.
 *
 * The scheduled time is snapped to a whole minute in UTC so sub-minute clock
 * skew between the notification trigger and the queue flush does not fork the
 * identity. This is also the key used for conflict-safe server sync.
 */
export function scheduledDoseId(medicationId: string, scheduledFor: string | Date): string {
  const ms =
    scheduledFor instanceof Date ? scheduledFor.getTime() : new Date(scheduledFor).getTime();
  if (Number.isNaN(ms)) {
    throw new Error('scheduledDoseId: invalid scheduledFor timestamp');
  }
  const minuteIso = new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
  return `dose:${medicationId}:${minuteIso}`;
}

/** Resolve the scheduled-dose identity for a log, deriving it if not stored. */
function resolveDoseId(log: Pick<DoseLog, 'scheduledDoseId' | 'medicationId' | 'scheduledFor' | 'takenAt'>): string {
  return log.scheduledDoseId ?? scheduledDoseId(log.medicationId, log.scheduledFor ?? log.takenAt);
}

/** True when `logs` already contains an entry for the same scheduled dose. */
export function isDoseAlreadyLogged(log: DoseLog, logs: DoseLog[]): boolean {
  const key = resolveDoseId(log);
  return logs.some((existing) => resolveDoseId(existing) === key);
}

/**
 * Conflict-safe dose logging. Stamps a stable `scheduledDoseId` and only writes
 * when no log for that dose exists yet. Returns the record that is authoritative
 * for the dose — the pre-existing one on a duplicate, the freshly written one
 * otherwise — plus a `duplicate` flag so callers and the server can converge on
 * a single record.
 *
 * Safe to call repeatedly from offline-queue replay and notification actions.
 */
export async function logDoseIdempotent(
  log: DoseLog,
): Promise<{ log: DoseLog; duplicate: boolean }> {
  const withId: DoseLog = { ...log, scheduledDoseId: resolveDoseId(log) };
  const existing = await getDoseLogs();
  const match = existing.find((l) => resolveDoseId(l) === withId.scheduledDoseId);
  if (match) {
    return { log: match, duplicate: true };
  }
  await dbAddDoseLog(withId);
  return { log: withId, duplicate: false };
}

// ── Dose state machine (#1049) ───────────────────────────────────────────────

/**
 * Resolve the current state of a scheduled dose from its logs.
 *
 * `missed` is derived, not stored: it is returned only once the grace period
 * after the scheduled instant has elapsed without an acknowledgement. A
 * `snoozed` log keeps the dose out of `missed` until the snooze window itself
 * expires, at which point it falls back to `pending` (and can later become
 * `missed`).
 */
export function resolveDoseState(
  medicationId: string,
  scheduledFor: string | Date,
  logs: DoseLog[],
  now: Date = new Date(),
  gracePeriodMs: number = DEFAULT_GRACE_PERIOD_MS,
): DoseState {
  const scheduledMs =
    scheduledFor instanceof Date ? scheduledFor.getTime() : new Date(scheduledFor).getTime();
  if (Number.isNaN(scheduledMs)) {
    throw new Error('resolveDoseState: invalid scheduledFor timestamp');
  }
  const key = scheduledDoseId(medicationId, scheduledMs);
  const match = logs.find((log) => resolveDoseId(log) === key);

  if (match) {
    const state = match.state ?? (match.skipped ? 'skipped' : 'taken');
    if (state === 'snoozed') {
      const until = match.snoozedUntil ? new Date(match.snoozedUntil).getTime() : NaN;
      if (!Number.isNaN(until) && until > now.getTime()) return 'snoozed';
      // Snooze window elapsed without acknowledgement — fall through to the
      // overdue check so the dose can still escalate to `missed`.
    } else {
      return state;
    }
  }

  return scheduledMs + gracePeriodMs < now.getTime() ? 'missed' : 'pending';
}

/**
 * Apply a dose transition idempotently.
 *
 * Replaying the same action (notification tap, offline-queue flush) for the
 * same scheduled dose returns the existing record with `duplicate: true`
 * instead of appending a second history entry. The scheduled occurrence id is
 * preserved across every transition for reconciliation.
 */
export async function transitionDose(
  medicationId: string,
  scheduledFor: string | Date,
  next: Exclude<DoseState, 'pending' | 'missed'>,
  options: { skipReason?: string; snoozeMs?: number; notes?: string; now?: Date } = {},
): Promise<{ log: DoseLog; duplicate: boolean; state: DoseState }> {
  const now = options.now ?? new Date();
  const scheduledIso =
    scheduledFor instanceof Date ? scheduledFor.toISOString() : new Date(scheduledFor).toISOString();
  const doseId = scheduledDoseId(medicationId, scheduledIso);

  const existing = await getDoseLogs();
  const match = existing.find((l) => resolveDoseId(l) === doseId);
  if (match) {
    return { log: match, duplicate: true, state: match.state ?? (match.skipped ? 'skipped' : 'taken') };
  }

  const log: DoseLog = {
    id: doseId,
    medicationId,
    takenAt: now.toISOString(),
    scheduledFor: scheduledIso,
    scheduledDoseId: doseId,
    state: next,
    acknowledgedAt: now.toISOString(),
    notes: options.notes,
  };
  if (next === 'skipped') {
    log.skipped = true;
    log.skipReason = options.skipReason;
  }
  if (next === 'snoozed') {
    const snoozeMs = options.snoozeMs ?? DEFAULT_SNOOZE_MS;
    log.snoozedUntil = new Date(now.getTime() + snoozeMs).toISOString();
  }

  await dbAddDoseLog(log);
  return { log, duplicate: false, state: next };
}

// ── Reminder scheduling (#1049) ──────────────────────────────────────────────

/**
 * Schedule a local notification reminder for a medication dose.
 *
 * Reminders are local-only (no server round-trip) so they keep working while
 * offline. The notification carries the stable `scheduledDoseId` so a tap can
 * be reconciled idempotently via {@link transitionDose}.
 */
export async function scheduleDoseReminder(
  medicationId: string,
  medicationName: string,
  scheduledFor: string | Date,
): Promise<string> {
  const scheduledIso =
    scheduledFor instanceof Date ? scheduledFor.toISOString() : new Date(scheduledFor).toISOString();
  const doseId = scheduledDoseId(medicationId, scheduledIso);
  const triggerDate = new Date(scheduledIso);

  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Medication reminder',
      body: `Time to take ${medicationName}`,
      data: {
        type: 'medication',
        medicationId,
        scheduledDoseId: doseId,
        scheduledFor: scheduledIso,
      },
      categoryIdentifier: 'medication',
    },
    trigger: { type: 'date', date: triggerDate } as Notifications.DateTriggerInput,
  });
}

/** Cancel a previously scheduled dose reminder by its notification id. */
export async function cancelDoseReminder(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
