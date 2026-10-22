/**
 * Calendar sync service — exports selected appointments to the device calendar.
 *
 * Issue #1186 turns the original silent auto-sync into an explicit, selectable
 * export while keeping everything the calendar API gives us on-device:
 *
 *  - **Private by default.** Nothing is written to the calendar until the user
 *    opts in (`syncEnabled`), and an exported event never carries the pet name
 *    or the appointment notes unless `includePetDetails` is also opted in.
 *  - **One appointment, one event.** A per-appointment record stores the event
 *    id plus a content revision, so re-exporting an unchanged appointment is a
 *    no-op and a changed appointment updates in place instead of duplicating.
 *  - **Self-healing.** An event the user deleted in the calendar app is
 *    detected (stale record) and re-created; an event that exists in the
 *    PetChain calendar without a record — e.g. after a reinstall wiped local
 *    storage — is adopted rather than duplicated, and surplus copies of the
 *    same slot are removed.
 *  - **Revocable.** Synced entries can be removed one at a time or all at once,
 *    offline, without any server round-trip.
 *
 * Everything here is device-local: the calls never touch the network, so the
 * existing offline behaviour is preserved. Server-confirmed availability is
 * resolved by the caller (`useCalendarExport` + `getCalendarExportPermissionState`)
 * and passed down through `CalendarExportOptions.serverConfirmed`, which is the
 * only gate this service enforces from outside.
 *
 * `expo-calendar` is imported dynamically so the native module stays optional
 * at test time and on platforms where it is unavailable.
 */

import { storageKeys } from '../config/storageKeys';
import type { Appointment } from '../models/Appointment';

/** Key used before #1186, when only `appointmentId → eventId` was remembered. */
const LEGACY_EVENT_ID_KEY = '@calendarEventIds';

/** Title of the dedicated device calendar PetChain writes into. */
export const PETCHAIN_CALENDAR_TITLE = 'PetChain';

/** Appointment duration used when the record does not carry one. */
export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;

/**
 * Event title when pet-identifying detail is not opted in. A device calendar is
 * readable by other apps and shown on lock screens, so the default body must not
 * reveal whose appointment it is or why it happens.
 */
export const GENERIC_EVENT_TITLE = 'Vet appointment';

/** Window searched for an existing event before a new one is created. */
const DUPLICATE_SCAN_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalendarSyncRecord {
  appointmentId: string;
  eventId: string;
  /** Revision of the event content last written; `''` when inherited from a legacy map. */
  revision: string;
  /** Whether pet-identifying detail was included in the event as written. */
  includePetDetails: boolean;
  /** ISO timestamp of the last successful write. */
  syncedAt: string;
}

export interface CalendarExportPreferences {
  /** Opt-in: no event is written to the calendar while this is `false`. */
  syncEnabled: boolean;
  /** Opt-in: include pet name and appointment notes in exported events. */
  includePetDetails: boolean;
}

export const DEFAULT_CALENDAR_EXPORT_PREFERENCES: CalendarExportPreferences = {
  syncEnabled: false,
  includePetDetails: false,
};

export interface CalendarEventDetails {
  title: string;
  startDate: Date;
  endDate: Date;
  timeZone: string;
  location: string;
  notes: string;
  alarms: { relativeOffset: number }[];
}

/**
 * Outcome for one appointment in an export run.
 * `disabled` and `permission_denied` are terminal for the run; the rest are per item.
 */
export type CalendarExportOutcome =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'adopted'
  | 'recreated'
  | 'permission_denied'
  | 'failed';

export type CalendarExportBlockedReason = 'permission_denied' | 'server_unconfirmed' | 'disabled';

export interface CalendarExportItemResult {
  appointmentId: string;
  outcome: CalendarExportOutcome;
  eventId?: string;
}

export interface CalendarExportResult {
  items: CalendarExportItemResult[];
  created: number;
  updated: number;
  unchanged: number;
  adopted: number;
  recreated: number;
  failed: number;
  /** Set when the run stopped before writing anything. */
  blocked: CalendarExportBlockedReason | null;
}

export type CalendarRemovalOutcome = 'removed' | 'already_gone' | 'not_synced' | 'failed';

export interface CalendarRemovalSummary {
  removed: number;
  alreadyGone: number;
  failed: number;
}

export interface CalendarExportOptions {
  /**
   * Server-confirmed availability for this account. `false` stops the run before
   * anything is written; `undefined` means the caller already resolved it (the
   * booking-time auto-sync path, which re-uses the user's confirmed opt-in).
   */
  serverConfirmed?: boolean;
  /** Privacy opt-in for this run. Defaults to the stored preference. */
  includePetDetails?: boolean;
  /**
   * `true` when the appointments were chosen by the user in the export sheet.
   * That is the moment calendar export is considered enabled for future
   * bookings, so the `syncEnabled` preference is switched on.
   */
  explicitSelection?: boolean;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function isRecordMap(value: unknown): Record<string, CalendarSyncRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, CalendarSyncRecord> = {};
  for (const [appointmentId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Partial<CalendarSyncRecord>;
    if (typeof candidate.eventId !== 'string' || !candidate.eventId) continue;
    out[appointmentId] = {
      appointmentId,
      eventId: candidate.eventId,
      revision: typeof candidate.revision === 'string' ? candidate.revision : '',
      includePetDetails: candidate.includePetDetails === true,
      syncedAt: typeof candidate.syncedAt === 'string' ? candidate.syncedAt : '',
    };
  }
  return out;
}

/** Legacy `appointmentId → eventId` maps are adopted, never re-created. */
function fromLegacyMap(raw: unknown): Record<string, CalendarSyncRecord> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, CalendarSyncRecord> = {};
  for (const [appointmentId, eventId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof eventId !== 'string' || !eventId) continue;
    // Pre-#1186 events always carried the pet name and notes, and their content
    // revision was never recorded — so they read as "changed" and get rewritten
    // privately on the next export instead of being duplicated.
    out[appointmentId] = {
      appointmentId,
      eventId,
      revision: '',
      includePetDetails: true,
      syncedAt: '',
    };
  }
  return out;
}

async function loadRecords(): Promise<Record<string, CalendarSyncRecord>> {
  const { getItem } = await import('./localDB');
  try {
    const raw = await getItem(storageKeys.calendar.eventRecords);
    if (raw) return isRecordMap(JSON.parse(raw) as unknown);
  } catch {
    // Corrupt or unreadable cache: fall through to the legacy map, then empty.
  }
  try {
    const legacy = await getItem(LEGACY_EVENT_ID_KEY);
    if (legacy) return fromLegacyMap(JSON.parse(legacy) as unknown);
  } catch {
    // ignore
  }
  return {};
}

async function saveRecords(records: Record<string, CalendarSyncRecord>): Promise<void> {
  const { setItem } = await import('./localDB');
  await setItem(storageKeys.calendar.eventRecords, JSON.stringify(records));
}

/** Validate untrusted stored JSON into a preferences object. */
export function toCalendarExportPreferences(value: unknown): CalendarExportPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_CALENDAR_EXPORT_PREFERENCES };
  }
  const raw = value as Record<string, unknown>;
  return {
    syncEnabled: raw.syncEnabled === true,
    includePetDetails: raw.includePetDetails === true,
  };
}

export async function loadCalendarPreferences(): Promise<CalendarExportPreferences> {
  try {
    const { getItem } = await import('./localDB');
    const raw = await getItem(storageKeys.calendar.exportPreferences);
    if (raw) return toCalendarExportPreferences(JSON.parse(raw) as unknown);
  } catch {
    // Unreadable preference cache means "not opted in": the safe default.
  }
  return { ...DEFAULT_CALENDAR_EXPORT_PREFERENCES };
}

export async function saveCalendarPreferences(
  patch: Partial<CalendarExportPreferences>,
): Promise<CalendarExportPreferences> {
  const next = { ...(await loadCalendarPreferences()), ...patch };
  try {
    const { setItem } = await import('./localDB');
    await setItem(storageKeys.calendar.exportPreferences, JSON.stringify(next));
  } catch {
    // Preference writes must never break the calendar flow.
  }
  return next;
}

// ─── Permission ───────────────────────────────────────────────────────────────

export async function requestCalendarPermission(): Promise<boolean> {
  try {
    const Calendar = await import('expo-calendar');
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

// ─── Get or create the PetChain calendar ─────────────────────────────────────

async function getPetChainCalendarId(): Promise<string | null> {
  try {
    const Calendar = await import('expo-calendar');
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const existing = calendars.find((c) => c.title === PETCHAIN_CALENDAR_TITLE);
    if (existing) return existing.id;

    // Create a new calendar
    const defaultSource =
      calendars.find((c) => c.source?.isLocalAccount)?.source ?? calendars[0]?.source;

    const id = await Calendar.createCalendarAsync({
      title: PETCHAIN_CALENDAR_TITLE,
      color: '#10B981',
      entityType: Calendar.EntityTypes.EVENT,
      sourceId: defaultSource?.id,
      source: defaultSource ?? { isLocalAccount: true, name: PETCHAIN_CALENDAR_TITLE, type: '' },
      name: PETCHAIN_CALENDAR_TITLE,
      ownerAccount: 'personal',
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
    return id;
  } catch {
    return null;
  }
}

// ─── Event content ────────────────────────────────────────────────────────────

function clockPart(value: string | undefined, max: number, fallback: number): number {
  const parsed = Number((value ?? '').trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return fallback;
  return Math.floor(parsed);
}

/**
 * Start of an appointment.
 *
 * `date` is `YYYY-MM-DD` for server records but a full ISO datetime for locally
 * created ones (see `AppointmentScreen.buildAppointment`), so the clock time is
 * only composed onto a bare date — appending it to an ISO string yields
 * `Invalid Date`, which the calendar APIs reject.
 */
export function resolveAppointmentStart(appt: Appointment): Date {
  const date = typeof appt.date === 'string' ? appt.date.trim() : '';
  const [hoursPart, minutesPart] = (typeof appt.time === 'string' ? appt.time : '').split(':');
  const hours = clockPart(hoursPart, 23, 9);
  const minutes = clockPart(minutesPart, 59, 0);

  const bareDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (bareDate) {
    return new Date(
      Number(bareDate[1]),
      Number(bareDate[2]) - 1,
      Number(bareDate[3]),
      hours,
      minutes,
    );
  }

  const parsed = new Date(date);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  // Unusable or time-only value: anchor the clock time to today rather than
  // writing an event the platform calendar would refuse.
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes);
}

/**
 * Build the event body for an appointment.
 *
 * With `includePetDetails` off — the default — the event carries a generic
 * title and no notes, so a glance at the lock screen or a calendar-reading
 * third-party app reveals nothing about the pet.
 */
export function buildEventDetails(
  appt: Appointment,
  includePetDetails: boolean,
): CalendarEventDetails {
  const startDate = resolveAppointmentStart(appt);
  const duration =
    typeof appt.durationMinutes === 'number' && appt.durationMinutes > 0
      ? appt.durationMinutes
      : DEFAULT_APPOINTMENT_DURATION_MINUTES;
  const endDate = new Date(startDate.getTime() + duration * 60_000);

  const petLabel = (appt.petName ?? appt.pet?.name ?? '').trim();
  const title = (appt.title ?? '').trim();
  const notes = (appt.notes ?? '').trim();

  return {
    title: includePetDetails && petLabel
      ? `${title || 'Vet appointment'} — ${petLabel}`
      : title || GENERIC_EVENT_TITLE,
    startDate,
    endDate,
    timeZone: appt.timeZone ?? 'UTC',
    // The clinic is not sensitive pet data; the user needs it to get there.
    location: appt.location ?? '',
    notes: includePetDetails ? notes : '',
    alarms: [
      { relativeOffset: -24 * 60 }, // 24h before
      { relativeOffset: -60 }, // 1h before
    ],
  };
}

/** FNV-1a: stable, dependency-free content hash for duplicate detection. */
function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Revision of what would be written for this appointment under these privacy
 * settings. Changing either the appointment or the detail opt-in changes it, so
 * an export after an opt-in change rewrites the event rather than skipping it.
 */
export function appointmentRevision(appt: Appointment, includePetDetails: boolean): string {
  const details = buildEventDetails(appt, includePetDetails);
  return hashString(
    [
      details.title,
      details.startDate.toISOString(),
      details.endDate.toISOString(),
      details.timeZone,
      details.location,
      details.notes,
    ].join('|'),
  );
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

type CalendarModule = typeof import('expo-calendar');

/** `false` when the user deleted the event in the calendar app. */
async function eventStillExists(Calendar: CalendarModule, eventId: string): Promise<boolean> {
  try {
    if (typeof Calendar.getEventAsync !== 'function') return true;
    const event = await Calendar.getEventAsync(eventId);
    return Boolean(event);
  } catch {
    return false;
  }
}

/**
 * Event start times come back from the native calendar as a `Date`, an epoch
 * number or an ISO string depending on the platform, so normalise before
 * comparing.
 */
function eventStartMs(startDate: Date | number | string): number {
  return (startDate instanceof Date ? startDate : new Date(startDate)).getTime();
}

/**
 * Find an event already occupying this slot in the PetChain calendar.
 *
 * Reached only when no record exists for the appointment (lost cache, reinstall,
 * or an export started on another install). Matching on title plus exact start
 * keeps a re-export from creating a second event for one appointment; surplus
 * copies of the same slot inside our own calendar are removed.
 */
async function findExistingEventId(
  Calendar: CalendarModule,
  calendarId: string,
  details: CalendarEventDetails,
): Promise<string | null> {
  if (typeof Calendar.getEventsAsync !== 'function') return null;
  try {
    const events = await Calendar.getEventsAsync(
      calendarId,
      new Date(details.startDate.getTime() - DUPLICATE_SCAN_WINDOW_MS),
      new Date(details.startDate.getTime() + DUPLICATE_SCAN_WINDOW_MS),
    );
    const startMs = details.startDate.getTime();
    const matches = (events ?? []).filter(
      (event) =>
        event.title === details.title && eventStartMs(event.startDate) === startMs,
    );
    if (matches.length === 0) return null;

    for (const duplicate of matches.slice(1)) {
      try {
        await Calendar.deleteEventAsync(duplicate.id);
      } catch {
        // Best effort: a leftover duplicate is repaired on the next export.
      }
    }
    return matches[0].id;
  } catch {
    return null;
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

function emptyResult(blocked: CalendarExportBlockedReason | null = null): CalendarExportResult {
  return {
    items: [],
    created: 0,
    updated: 0,
    unchanged: 0,
    adopted: 0,
    recreated: 0,
    failed: 0,
    blocked,
  };
}

function summarize(
  items: CalendarExportItemResult[],
  blocked: CalendarExportBlockedReason | null = null,
): CalendarExportResult {
  const count = (outcome: CalendarExportOutcome) =>
    items.filter((item) => item.outcome === outcome).length;
  return {
    items,
    created: count('created'),
    updated: count('updated'),
    unchanged: count('unchanged'),
    adopted: count('adopted'),
    recreated: count('recreated'),
    failed: count('failed'),
    blocked,
  };
}

function allOutcome(
  appointments: Appointment[],
  outcome: CalendarExportOutcome,
): CalendarExportItemResult[] {
  return appointments.map((appt) => ({ appointmentId: appt.id, outcome }));
}

function recordFor(
  appointmentId: string,
  eventId: string,
  revision: string,
  includePetDetails: boolean,
): CalendarSyncRecord {
  return {
    appointmentId,
    eventId,
    revision,
    includePetDetails,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Write one appointment, keeping the event count at one per appointment.
 * Mutates `records` so the caller can persist the whole batch in one write.
 */
async function exportOne(
  Calendar: CalendarModule,
  calendarId: string,
  records: Record<string, CalendarSyncRecord>,
  appt: Appointment,
  includePetDetails: boolean,
): Promise<CalendarExportItemResult> {
  const appointmentId = appt.id;
  if (!appointmentId) return { appointmentId, outcome: 'failed' };

  const details = buildEventDetails(appt, includePetDetails);
  const revision = appointmentRevision(appt, includePetDetails);
  const existing = records[appointmentId];

  if (existing) {
    if (existing.revision === revision && existing.includePetDetails === includePetDetails) {
      // Same content already on the device: skip, don't create a duplicate.
      return { appointmentId, outcome: 'unchanged', eventId: existing.eventId };
    }

    if (await eventStillExists(Calendar, existing.eventId)) {
      await Calendar.updateEventAsync(existing.eventId, details);
      records[appointmentId] = recordFor(
        appointmentId,
        existing.eventId,
        revision,
        includePetDetails,
      );
      return { appointmentId, outcome: 'updated', eventId: existing.eventId };
    }

    // Stale record: the event was deleted outside PetChain.
    const reclaimed = await findExistingEventId(Calendar, calendarId, details);
    const recreatedId = reclaimed ?? (await Calendar.createEventAsync(calendarId, details));
    records[appointmentId] = recordFor(appointmentId, recreatedId, revision, includePetDetails);
    return { appointmentId, outcome: 'recreated', eventId: recreatedId };
  }

  const orphanId = await findExistingEventId(Calendar, calendarId, details);
  if (orphanId) {
    // Adopt the event that is already there instead of writing a second one.
    await Calendar.updateEventAsync(orphanId, details);
    records[appointmentId] = recordFor(appointmentId, orphanId, revision, includePetDetails);
    return { appointmentId, outcome: 'adopted', eventId: orphanId };
  }

  const eventId = await Calendar.createEventAsync(calendarId, details);
  records[appointmentId] = recordFor(appointmentId, eventId, revision, includePetDetails);
  return { appointmentId, outcome: 'created', eventId };
}

/**
 * Export appointments to the device calendar.
 *
 * Appointments are written one at a time: the platform calendar providers are
 * not safe under concurrent writes, and it keeps a single failing event from
 * aborting the whole selection.
 */
export async function exportAppointments(
  appointments: Appointment[],
  options: CalendarExportOptions = {},
): Promise<CalendarExportResult> {
  if (options.serverConfirmed === false) {
    return emptyResult('server_unconfirmed');
  }
  if (!appointments || appointments.length === 0) {
    return emptyResult();
  }

  const granted = await requestCalendarPermission();
  if (!granted) {
    return summarize(allOutcome(appointments, 'permission_denied'), 'permission_denied');
  }

  const calendarId = await getPetChainCalendarId();
  if (!calendarId) {
    // The PetChain calendar could not be found or created. Reported as failures
    // rather than an empty success, so the sheet offers a retry.
    return summarize(allOutcome(appointments, 'failed'), null);
  }

  const preferences = await loadCalendarPreferences();
  const includePetDetails = options.includePetDetails ?? preferences.includePetDetails;
  const Calendar = await import('expo-calendar');
  const records = await loadRecords();

  const items: CalendarExportItemResult[] = [];
  for (const appt of appointments) {
    try {
      items.push(await exportOne(Calendar, calendarId, records, appt, includePetDetails));
    } catch {
      items.push({ appointmentId: appt.id, outcome: 'failed' });
    }
  }

  try {
    await saveRecords(records);
  } catch {
    // The events are already on the device; the next export adopts them.
  }

  // Choosing appointments in the export sheet is the opt-in for future bookings.
  if (options.explicitSelection && !preferences.syncEnabled && items.length > 0) {
    await saveCalendarPreferences({ syncEnabled: true });
  }

  return summarize(items);
}

/**
 * Sync a confirmed appointment to the device calendar.
 *
 * Called after booking and after rescheduling. It is a no-op until the user has
 * enabled calendar export, which is what keeps appointment data private by
 * default. Creates a new event or updates the existing one (idempotent).
 */
export async function syncAppointmentToCalendar(appt: Appointment): Promise<string | null> {
  const preferences = await loadCalendarPreferences();
  if (!preferences.syncEnabled) return null;

  const result = await exportAppointments([appt], {
    includePetDetails: preferences.includePetDetails,
  });
  return result.items[0]?.eventId ?? null;
}

// ─── Remove / revoke ──────────────────────────────────────────────────────────

/**
 * Remove one appointment's calendar event.
 *
 * Works offline and without server confirmation: revoking what is already on
 * the device must never depend on the network. A record whose event is already
 * gone is cleared all the same, so the appointment never stays stuck as synced.
 */
export async function removeSyncedAppointment(
  appointmentId: string,
): Promise<CalendarRemovalOutcome> {
  const records = await loadRecords();
  const record = records[appointmentId];
  if (!record) return 'not_synced';

  // `null` when the native module could not be loaded at all — there is no way
  // to touch the event, but nothing on this device can show it as synced either.
  let existed: boolean | null = null;
  let deleteFailed = false;

  try {
    const Calendar = await import('expo-calendar');
    existed = await eventStillExists(Calendar, record.eventId);
    if (existed) {
      try {
        await Calendar.deleteEventAsync(record.eventId);
      } catch {
        deleteFailed = true;
      }
    }
  } catch {
    existed = null;
  }

  // A failed delete keeps the record: without the event id there is no way to
  // retry, and the event would stay on the device unnoticed.
  if (deleteFailed) return 'failed';

  delete records[appointmentId];
  try {
    await saveRecords(records);
  } catch {
    return 'failed';
  }
  return existed === true ? 'removed' : 'already_gone';
}

/** Remove every event PetChain created, leaving the opt-in untouched. */
export async function removeAllSyncedAppointments(): Promise<CalendarRemovalSummary> {
  const records = await loadRecords();
  const summary: CalendarRemovalSummary = { removed: 0, alreadyGone: 0, failed: 0 };

  for (const appointmentId of Object.keys(records)) {
    // Sequential on purpose: overlapping calendar writes are not safe on Android.
    const outcome = await removeSyncedAppointment(appointmentId);
    if (outcome === 'removed') summary.removed += 1;
    else if (outcome === 'already_gone') summary.alreadyGone += 1;
    else if (outcome === 'failed') summary.failed += 1;
  }

  try {
    const { removeItem } = await import('./localDB');
    await removeItem(LEGACY_EVENT_ID_KEY);
  } catch {
    // Legacy cache cleanup is cosmetic.
  }
  return summary;
}

/**
 * Revoke calendar sync: delete every synced event, forget all records, and turn
 * both opt-ins off so nothing new is written. Appointments themselves are
 * untouched.
 */
export async function revokeCalendarSync(): Promise<CalendarRemovalSummary> {
  const summary = await removeAllSyncedAppointments();
  await saveCalendarPreferences({ ...DEFAULT_CALENDAR_EXPORT_PREFERENCES });
  return summary;
}

/** Remove a cancelled/deleted appointment from the device calendar. */
export async function removeAppointmentFromCalendar(appointmentId: string): Promise<void> {
  await removeSyncedAppointment(appointmentId).catch(() => {});
}

// ─── Status for the manage UI ─────────────────────────────────────────────────

/** Every appointment currently represented by an event on the device. */
export async function getSyncedAppointments(): Promise<CalendarSyncRecord[]> {
  const records = await loadRecords();
  return Object.values(records).sort((a, b) => a.appointmentId.localeCompare(b.appointmentId));
}

/** Returns the calendar event ID for an appointment, or null if not synced. */
export async function getCalendarEventId(appointmentId: string): Promise<string | null> {
  const records = await loadRecords();
  return records[appointmentId]?.eventId ?? null;
}

/** Whether calendar export is enabled for this device. */
export async function isCalendarSyncEnabled(): Promise<boolean> {
  return (await loadCalendarPreferences()).syncEnabled;
}
