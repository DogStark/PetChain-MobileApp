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

export interface DoseLog {
  id: string;
  medicationId: string;
  takenAt: string; // ISO string
  skipped?: boolean;
  scheduledFor?: string;
  notes?: string;
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
      med.remainingPills !== undefined &&
      med.totalPills !== undefined &&
      med.totalPills > 0 &&
      med.remainingPills <= med.totalPills * threshold,
  );
}

export function getMedicationEndDate(med: Medication): Date | null {
  if (!med.endDate) return null;
  const end = new Date(med.endDate);
  return Number.isNaN(end.getTime()) ? null : end;
}

export function isMedicationActive(med: Medication, date = new Date()): boolean {
  const now = date;
  const start = new Date(med.startDate);
  if (Number.isNaN(start.getTime()) || now < start) return false;
  const end = getMedicationEndDate(med);
  if (end && now > end) return false;
  return med.status !== 'paused' && med.status !== 'discontinued';
}

export function getScheduleForRange(med: Medication, fromDate: Date, toDate: Date): Date[] {
  const times: Date[] = [];
  const start = new Date(med.startDate);
  if (Number.isNaN(start.getTime()) || fromDate > toDate) return times;

  const end = getMedicationEndDate(med);
  if (end && fromDate > end) return times;

  const intervalMs = med.frequency * 60 * 60 * 1000;
  if (intervalMs <= 0) return times;

  if (toDate < start) return times;

  let cursor = new Date(start);
  if (cursor < fromDate) {
    const diff = fromDate.getTime() - cursor.getTime();
    const steps = Math.ceil(diff / intervalMs);
    cursor = new Date(cursor.getTime() + steps * intervalMs);
  }

  const lastDate = end && end < toDate ? end : toDate;
  while (cursor <= lastDate) {
    if (cursor >= fromDate) {
      times.push(new Date(cursor));
    }
    cursor = new Date(cursor.getTime() + intervalMs);
  }

  return times;
}

export function getDaySchedule(med: Medication, date: Date): Date[] {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  return getScheduleForRange(med, dayStart, dayEnd);
}

export function getUpcomingDoseTimes(med: Medication, days = 7, fromDate = new Date()): Date[] {
  const windowEnd = new Date(fromDate);
  windowEnd.setDate(windowEnd.getDate() + days);
  return getScheduleForRange(med, fromDate, windowEnd);
}

// ── Refill estimation ─────────────────────────────────────────────────────────

/**
 * Compute how many doses per day a medication requires based on its frequency
 * (hours between doses). Returns a positive number; minimum 0.01 to avoid
 * divide-by-zero when frequency is unreasonably large.
 */
export function computeDosesPerDay(frequencyHours: number): number {
  if (frequencyHours <= 0) return 1;
  return Math.max(0.01, 24 / frequencyHours);
}

/**
 * Estimate the date when the current supply will run out.
 *
 * @param supply         Number of doses/pills currently on hand.
 * @param frequencyHours Hours between each dose.
 * @param fromDate       Reference date (defaults to now).
 * @returns ISO string of the estimated run-out date, or null if inputs are invalid.
 */
export function estimateRunOutDate(
  supply: number,
  frequencyHours: number,
  fromDate: Date = new Date(),
): string | null {
  if (supply <= 0 || frequencyHours <= 0) return null;
  const dosesPerDay = computeDosesPerDay(frequencyHours);
  const daysLeft = supply / dosesPerDay;
  const runOut = new Date(fromDate.getTime() + daysLeft * 24 * 60 * 60 * 1000);
  return runOut.toISOString();
}

/**
 * Derive the human-readable refill status from the estimated run-out date.
 *
 * Thresholds:
 *  - out     : 0 days remaining
 *  - urgent  : ≤ 3 days remaining
 *  - warning : ≤ 7 days remaining
 *  - ok      : > 7 days remaining
 *  - unknown : no supply information
 */
export function getRefillStatus(med: Medication, now: Date = new Date()): RefillStatus {
  const supply = med.currentSupply ?? med.remainingPills;
  if (supply === undefined || supply === null) return 'unknown';
  if (supply <= 0) return 'out';

  const runOutIso = med.estimatedRunOutDate ?? estimateRunOutDate(supply, med.frequency);
  if (!runOutIso) return 'unknown';

  const runOut = new Date(runOutIso);
  const daysLeft = (runOut.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

  if (daysLeft <= 0) return 'out';
  if (daysLeft <= 3) return 'urgent';
  if (daysLeft <= 7) return 'warning';
  return 'ok';
}

/**
 * Recalculate the estimated run-out date for a medication and persist it back
 * to the DB.  Should be called after every dose log or supply update.
 */
export async function refreshRunOutDate(med: Medication): Promise<Medication> {
  const supply = med.currentSupply ?? med.remainingPills;
  const runOutIso =
    supply !== undefined && supply > 0 ? estimateRunOutDate(supply, med.frequency) : undefined;

  const updated: Medication = {
    ...med,
    estimatedRunOutDate: runOutIso ?? undefined,
    dosesPerDay: computeDosesPerDay(med.frequency),
  };
  await upsertMedication(updated);
  return updated;
}

// ── Refill push notifications ─────────────────────────────────────────────────

/**
 * Cancel any previously-scheduled refill reminder notifications for a
 * medication so we don't send stale alerts after a supply update.
 */
async function cancelRefillNotifications(med: Medication): Promise<void> {
  if (!med.refillNotificationIds?.length) return;
  await Promise.all(
    med.refillNotificationIds.map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => {}),
    ),
  );
}

/**
 * Schedule push notifications 7 days and 3 days before the estimated run-out
 * date.  Previous refill reminders for this medication are cancelled first.
 *
 * @returns Array of scheduled notification IDs (empty if nothing was scheduled).
 */
export async function scheduleRefillNotifications(med: Medication): Promise<string[]> {
  await cancelRefillNotifications(med);

  const supply = med.currentSupply ?? med.remainingPills;
  if (supply === undefined || supply <= 0) return [];

  const runOutIso = med.estimatedRunOutDate ?? estimateRunOutDate(supply, med.frequency);
  if (!runOutIso) return [];

  const runOut = new Date(runOutIso);
  const now = new Date();
  const notificationIds: string[] = [];

  for (const leadDays of [7, 3]) {
    const triggerDate = new Date(runOut);
    triggerDate.setDate(runOut.getDate() - leadDays);
    triggerDate.setHours(9, 0, 0, 0); // 9 AM on the reminder day

    if (triggerDate <= now) continue; // already past, skip

    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: '💊 Refill Reminder',
          body:
            leadDays === 7
              ? `${med.name} will run out in about 7 days. Time to request a refill!`
              : `⚠️ ${med.name} supply is critically low — runs out in ~3 days!`,
          sound: 'default',
          data: {
            type: 'medication',
            subType: 'refill',
            medicationId: med.id,
            leadDays,
            estimatedRunOutDate: runOutIso,
          },
          categoryIdentifier: 'medication',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
        },
      });
      notificationIds.push(id);
    } catch {
      // Non-fatal — scheduling may fail in Expo Go without native build
    }
  }

  return notificationIds;
}

/**
 * Full refill-reminder pipeline:
 *  1. Recalculate estimated run-out date.
 *  2. Cancel stale refill notifications.
 *  3. Schedule new notifications at 7-day and 3-day lead times.
 *  4. Persist the updated medication (with new notification IDs).
 *
 * @returns Updated medication object.
 */
export async function syncRefillReminders(med: Medication): Promise<Medication> {
  const withRunOut = await refreshRunOutDate(med);
  const notificationIds = await scheduleRefillNotifications(withRunOut);

  const final: Medication = {
    ...withRunOut,
    refillNotificationIds: notificationIds,
  };
  await upsertMedication(final);
  return final;
}

// ── Refill completion ─────────────────────────────────────────────────────────

/**
 * Mark a medication refill as completed: reset the supply count, update
 * lastRefillDate, recalculate the run-out date, and reschedule notifications.
 *
 * @param med          The medication to update.
 * @param newSupply    Number of doses/pills after refill.
 * @returns Updated medication.
 */
export async function markRefillComplete(med: Medication, newSupply: number): Promise<Medication> {
  const now = new Date().toISOString();
  const updated: Medication = {
    ...med,
    currentSupply: newSupply,
    remainingPills: newSupply, // keep legacy field in sync
    lastRefillDate: now,
  };
  return syncRefillReminders(updated);
}

// ── Legacy refill reminder (kept for backwards compat) ─────────────────────

export async function scheduleRefillReminder(med: Medication): Promise<void> {
  if (!med.refillDate) return;
  const trigger = new Date(med.refillDate);
  trigger.setHours(9, 0, 0, 0); // 9 AM on refill day
  if (trigger <= new Date()) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Refill Reminder',
      body: `Time to refill ${med.name}`,
      data: { medicationId: med.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
  });
}

// ── Interaction-warning data provenance & freshness (issue #959) ───────────────

/**
 * Provenance for the bundled medication-interaction knowledge base. Interaction
 * warnings are only as trustworthy as the dataset behind them, so every warning
 * surfaced to an owner must be able to state where it came from, which version
 * produced it, and how old that data is.
 *
 * Synthetic placeholder values — replace `source`/`version`/`publishedAt` from
 * the real dataset manifest at build time. No PII or health records here.
 */
export const INTERACTION_DATA_PROVENANCE = {
  /** Human-readable name of the dataset / reference used to derive warnings. */
  source: 'PetChain Bundled Interaction Reference',
  /** Semantic version of the dataset shipped with this build. */
  version: '0.0.0-bundled',
  /** ISO date the dataset snapshot was published upstream. */
  publishedAt: '2026-01-01T00:00:00.000Z',
  /** Where the maintained dataset lives, for audit / update tooling. */
  reference: 'https://petchain.app/docs/medication-interaction-data',
} as const;

/** Number of days after which bundled interaction data is considered stale. */
export const INTERACTION_DATA_STALE_AFTER_DAYS = 90;
/** Number of days after which bundled interaction data must not be shown as authoritative. */
export const INTERACTION_DATA_UNAVAILABLE_AFTER_DAYS = 180;

export type InteractionDataFreshness = 'fresh' | 'stale' | 'expired';

export interface InteractionDataStatus {
  freshness: InteractionDataFreshness;
  /** Age of the dataset in whole days relative to `now`. */
  ageDays: number;
  /** True while the data may be presented as clinically meaningful guidance. */
  authoritative: boolean;
  /** True when the data is too old to show warnings from at all. */
  unavailable: boolean;
  provenance: typeof INTERACTION_DATA_PROVENANCE;
  /** Policy describing how/when the dataset is refreshed. */
  updatePolicy: string;
  /** Owner-facing disclaimer that must accompany any interaction warning. */
  disclaimer: string;
}

const INTERACTION_UPDATE_POLICY =
  'Interaction data ships with the app and refreshes on app update. ' +
  `Data older than ${INTERACTION_DATA_STALE_AFTER_DAYS} days is flagged as stale; ` +
  `data older than ${INTERACTION_DATA_UNAVAILABLE_AFTER_DAYS} days is withheld until the app is updated.`;

const BASE_DISCLAIMER =
  'This is an automated screening aid, not veterinary advice. ' +
  'Always confirm medication safety with your veterinarian.';

/**
 * Assess how fresh the bundled interaction dataset is and what may be shown to
 * the owner as a result. Pure function — pass `now` for deterministic tests.
 */
export function assessInteractionDataFreshness(
  now: Date = new Date(),
  provenance: typeof INTERACTION_DATA_PROVENANCE = INTERACTION_DATA_PROVENANCE,
): InteractionDataStatus {
  const publishedMs = new Date(provenance.publishedAt).getTime();
  const ageDays = Number.isNaN(publishedMs)
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Math.floor((now.getTime() - publishedMs) / (24 * 60 * 60 * 1000)));

  const unavailable = ageDays >= INTERACTION_DATA_UNAVAILABLE_AFTER_DAYS;
  const stale = !unavailable && ageDays >= INTERACTION_DATA_STALE_AFTER_DAYS;
  const freshness: InteractionDataFreshness = unavailable ? 'expired' : stale ? 'stale' : 'fresh';

  let disclaimer = BASE_DISCLAIMER;
  if (stale) {
    disclaimer =
      `Interaction data is ${ageDays} days old and may be out of date. ` +
      'Do not rely on these warnings as current — update the app and consult your veterinarian.';
  } else if (unavailable) {
    disclaimer =
      'Interaction screening is unavailable because the local data is too old to be trusted. ' +
      'Update the app to restore it, and consult your veterinarian in the meantime.';
  }

  return {
    freshness,
    ageDays,
    authoritative: freshness === 'fresh',
    unavailable,
    provenance,
    updatePolicy: INTERACTION_UPDATE_POLICY,
    disclaimer,
  };
}

export interface PresentedInteractionWarning {
  message: string;
  /** Provenance line safe to render under the warning, e.g. "Source X v1 · 12 days old". */
  attribution: string;
  disclaimer: string;
  /** False when the warning must be visually de-emphasised (stale/expired data). */
  authoritative: boolean;
  /** True when no warning should be shown and the unavailable state is surfaced instead. */
  suppressed: boolean;
}

/**
 * Wrap a raw interaction-warning string with provenance, an attribution line and
 * the freshness-appropriate disclaimer. When the dataset is expired the warning
 * is suppressed and the caller should show the unavailable state instead.
 */
export function presentInteractionWarning(
  rawMessage: string,
  now: Date = new Date(),
): PresentedInteractionWarning {
  const status = assessInteractionDataFreshness(now);
  const { source, version } = status.provenance;
  const attribution =
    `Source: ${source} ${version} · ${INTERACTION_DATA_PROVENANCE.publishedAt.slice(0, 10)}` +
    ` · ${status.ageDays === Number.POSITIVE_INFINITY ? 'unknown age' : `${status.ageDays} days old`}`;

  return {
    message: status.unavailable ? '' : rawMessage,
    attribution,
    disclaimer: status.disclaimer,
    authoritative: status.authoritative,
    suppressed: status.unavailable,
  };
}
