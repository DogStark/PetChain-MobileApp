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
    scheduledFor: scheduledIso,
    scheduledDoseId: doseId,
    takenAt: now.toISOString(),
    acknowledgedAt: now.toISOString(),
    state: next,
    skipped: next === 'skipped',
    skipReason: next === 'skipped' ? options.skipReason : undefined,
    snoozedUntil:
      next === 'snoozed'
        ? new Date(now.getTime() + (options.snoozeMs ?? DEFAULT_SNOOZE_MS)).toISOString()
        : undefined,
    notes: options.notes,
  };

  await dbAddDoseLog(log);
  return { log, duplicate: false, state: next };
}

/**
 * Escalate overdue doses to `missed` by writing a missed log for each dose
 * whose grace period has expired without acknowledgement. Idempotent: doses
 * that already have a log are skipped, so repeated sweeps never duplicate
 * history. Returns the missed logs that were newly written.
 */
export async function escalateMissedDoses(
  medications: Medication[],
  fromDate: Date,
  toDate: Date,
  now: Date = new Date(),
  gracePeriodMs: number = DEFAULT_GRACE_PERIOD_MS,
): Promise<DoseLog[]> {
  const logs = await getDoseLogs();
  const written: DoseLog[] = [];
  for (const med of medications) {
    for (const doseTime of getScheduleForRange(med, fromDate, toDate)) {
      if (resolveDoseState(med.id, doseTime, logs, now, gracePeriodMs) !== 'missed') continue;
      const doseId = scheduledDoseId(med.id, doseTime);
      if (logs.some((l) => resolveDoseId(l) === doseId)) continue;
      const log: DoseLog = {
        id: doseId,
        medicationId: med.id,
        scheduledFor: doseTime.toISOString(),
        scheduledDoseId: doseId,
        takenAt: doseTime.toISOString(),
        state: 'missed',
      };
      await dbAddDoseLog(log);
      logs.push(log);
      written.push(log);
    }
  }
  return written;
}

// ── Timezone-safe schedule reconciliation (#957) ─────────────────────────────

export interface ScheduledDose {
  /** OS notification identifier, when this dose is already scheduled. */
  notificationId?: string;
  medicationId: string;
  /** Absolute instant the dose is due (Date or ISO string). */
  fireDate: Date | string;
}

/**
 * Identity of a scheduled dose as an absolute UTC instant (snapped to the
 * minute). Editing a schedule or crossing a timezone — including DST
 * transitions and overnight doses — must not change this key for a dose still
 * due at the same real-world moment, so reconciliation drops duplicates instead
 * of stacking overlapping local notifications.
 */
export function doseIdentityKey(dose: ScheduledDose): string {
  const ms = dose.fireDate instanceof Date ? dose.fireDate.getTime() : new Date(dose.fireDate).getTime();
  if (Number.isNaN(ms)) {
    throw new Error('doseIdentityKey: invalid fireDate');
  }
  const minuteIso = new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
  return `${dose.medicationId}@${minuteIso}`;
}

/**
 * Reconcile a freshly-computed desired schedule against what is already
 * scheduled with the OS, keyed by dose identity.
 *
 * @returns `toCancel` — notification IDs that are stale or exact duplicates;
 *          `toSchedule` — desired doses not yet scheduled;
 *          `keep` — notification IDs that already match a desired dose.
 */
export function reconcileDoseSchedules(
  existing: ScheduledDose[],
  desired: ScheduledDose[],
): { toCancel: string[]; toSchedule: ScheduledDose[]; keep: string[] } {
  const existingByKey = new Map<string, ScheduledDose[]>();
  for (const dose of existing) {
    const key = doseIdentityKey(dose);
    const group = existingByKey.get(key);
    if (group) group.push(dose);
    else existingByKey.set(key, [dose]);
  }

  const desiredKeys = new Set(desired.map(doseIdentityKey));
  const toCancel: string[] = [];
  const keep: string[] = [];

  for (const [key, group] of existingByKey) {
    const [first, ...duplicates] = group;
    for (const dup of duplicates) {
      if (dup.notificationId) toCancel.push(dup.notificationId);
    }
    if (desiredKeys.has(key)) {
      if (first.notificationId) keep.push(first.notificationId);
    } else if (first.notificationId) {
      toCancel.push(first.notificationId);
    }
  }

  const existingKeys = new Set(existing.map(doseIdentityKey));
  const toSchedule = desired.filter((dose) => !existingKeys.has(doseIdentityKey(dose)));

  return { toCancel, toSchedule, keep };
}

export function getDoseStatus(
  medicationId: string,
  scheduledTime: Date,
  logs: DoseLog[],
): 'taken' | 'skipped' | 'missed' | 'pending' {
  const windowMs = 30 * 60 * 1000;
  const match = logs.find((log) => {
    if (log.medicationId !== medicationId) return false;
    if (log.scheduledFor)
      return Math.abs(new Date(log.scheduledFor).getTime() - scheduledTime.getTime()) <= windowMs;
    return Math.abs(new Date(log.takenAt).getTime() - scheduledTime.getTime()) <= windowMs;
  });
  if (match?.skipped) return 'skipped';
  if (match) return 'taken';
  return scheduledTime.getTime() + windowMs < Date.now() ? 'missed' : 'pending';
}

export function calculateAdherence(
  medications: Medication[],
  logs: DoseLog[],
  fromDate: Date,
  toDate: Date,
): MedicationAdherence {
  let scheduled = 0;
  let taken = 0;
  let skipped = 0;
  let missed = 0;
  medications.forEach((med) => {
    getScheduleForRange(med, fromDate, toDate).forEach((doseTime) => {
      scheduled += 1;
      const status = getDoseStatus(med.id, doseTime, logs);
      if (status === 'taken') taken += 1;
      if (status === 'skipped') skipped += 1;
      if (status === 'missed') missed += 1;
    });
  });
  const denominator = Math.max(1, scheduled - skipped);
  return { scheduled, taken, skipped, missed, score: Math.round((taken / denominator) * 100) };
}

export function getLowRefillMedications(medications: Medication[], threshold = 0.2): Medication[] {
  return medications.filter(
    (med) =>
