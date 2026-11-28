/**
 * Calendar export copy and selection rules (issue #1186).
 *
 * Pure module: the export sheet is a thin React wrapper over these, so the
 * spoken labels and result wording stay testable without a renderer — the same
 * split documented in docs/ACCESSIBILITY.md.
 */

import { AppointmentStatus, type Appointment } from '../models/Appointment';
import type {
  CalendarExportResult,
  CalendarRemovalSummary,
} from '../services/calendarSyncService';

/**
 * Statuses that must not be offered for export.
 *
 * A cancelled or no-show slot is not in anyone's diary, and exporting it would
 * re-create an event the cancel/reschedule flow just removed. Completed visits
 * stay exportable: users plan around past treatments (boosters, follow-ups).
 */
const NON_EXPORTABLE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CANCELLED,
  AppointmentStatus.NO_SHOW,
];

export function isExportableAppointment(appt: Appointment): boolean {
  if (!appt || typeof appt.id !== 'string' || appt.id.length === 0) return false;
  return !NON_EXPORTABLE_STATUSES.includes(appt.status);
}

/**
 * Spoken label for one selectable row.
 *
 * Carries the sync state in words, never by colour alone (WCAG 1.4.1), and is
 * deliberately read back in full on each row so a screen reader user can tell
 * two same-titled appointments apart.
 */
export function buildAppointmentEventLabel(
  appt: Appointment,
  /** `when` is already localised, e.g. "May 12, 2026, 9:00 AM". */
  options: { when: string; synced: boolean },
): string {
  const who = (appt.petName ?? appt.pet?.name ?? '').trim();
  const what = (appt.title ?? '').trim() || 'Appointment';
  const parts = [who ? `${what} for ${who}` : what];
  if (options.when) parts.push(options.when);
  if (options.synced) parts.push('already in your calendar');
  return parts.join(', ');
}

/** Live-region text for the selection counter. */
export function calendarSelectionAnnouncement(selected: number, total: number): string {
  if (total === 0) return 'No appointments available to export.';
  if (selected === 0) return `${total} appointments available. None selected.`;
  if (selected === total) return `All ${total} appointments selected.`;
  return `${selected} of ${total} appointments selected.`;
}

/**
 * Result summary after an export run.
 *
 * Every outcome is named, including the ones that wrote nothing, so "no change"
 * is never mistaken for a failure — or for a duplicate being created.
 */
export function calendarExportSummaryText(result: CalendarExportResult): string {
  if (result.blocked === 'permission_denied') {
    return 'Calendar access was not granted, so nothing was exported.';
  }
  if (result.blocked === 'server_unconfirmed') {
    return 'Your account has not confirmed calendar export yet, so nothing was exported.';
  }
  if (result.blocked === 'disabled') {
    return 'Calendar export is turned off, so nothing was exported.';
  }
  if (result.items.length === 0) {
    return 'No appointments were selected, so nothing was exported.';
  }

  const parts: string[] = [];
  if (result.created) parts.push(`${result.created} added`);
  if (result.updated) parts.push(`${result.updated} updated`);
  if (result.recreated) {
    parts.push(`${result.recreated} re-added after being deleted on this device`);
  }
  if (result.adopted) parts.push(`${result.adopted} matched to events already in your calendar`);
  if (result.unchanged) parts.push(`${result.unchanged} already up to date`);
  if (result.failed) parts.push(`${result.failed} could not be written`);

  const lead = parts.length > 0 ? parts.join(', ') : 'Nothing changed';
  return result.failed > 0
    ? `${lead}. Retry the failed ones — your appointment data is untouched.`
    : `${lead}.`;
}

/** Wording for the privacy opt-in, so the default is stated rather than implied. */
export function calendarPrivacyText(includePetDetails: boolean): string {
  return includePetDetails
    ? 'Events will include the pet name and appointment notes. Other apps and lock-screen previews can read your calendar, so only turn this on if that is okay for you.'
    : 'Events stay private by default: no pet name and no notes. Only the time and the clinic appear.';
}

/** Wording for a bulk removal (remove all / revoke). */
export function calendarRemovalSummaryText(summary: CalendarRemovalSummary): string {
  if (summary.removed === 0 && summary.alreadyGone === 0 && summary.failed === 0) {
    return 'No PetChain events were in your calendar.';
  }
  const parts: string[] = [];
  if (summary.removed) parts.push(`${summary.removed} removed from your calendar`);
  if (summary.alreadyGone) parts.push(`${summary.alreadyGone} were already deleted`);
  if (summary.failed) parts.push(`${summary.failed} could not be removed`);
  return `${parts.join(', ')}. Your appointments are unchanged.`;
}
