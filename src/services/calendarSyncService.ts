/**
 * Calendar sync service — syncs confirmed appointments to the device calendar.
 *
 * Uses expo-calendar (dynamically imported so the module is optional at test time).
 * Stores a mapping of appointmentId → calendarEventId in AsyncStorage to prevent
 * duplicate events and enable updates/deletions.
 */

import type { Appointment } from '../models/Appointment';

const STORAGE_KEY = '@calendarEventIds';

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function loadMap(): Promise<Record<string, string>> {
  try {
    const { getItem } = await import('./localDB');
    const raw = await getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function saveMap(map: Record<string, string>): Promise<void> {
  const { setItem } = await import('./localDB');
  await setItem(STORAGE_KEY, JSON.stringify(map));
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
    const existing = calendars.find((c) => c.title === 'PetChain');
    if (existing) return existing.id;

    // Create a new calendar
    const defaultSource =
      calendars.find((c) => c.source?.isLocalAccount)?.source ?? calendars[0]?.source;

    const id = await Calendar.createCalendarAsync({
      title: 'PetChain',
      color: '#10B981',
      entityType: Calendar.EntityTypes.EVENT,
      sourceId: defaultSource?.id,
      source: defaultSource ?? { isLocalAccount: true, name: 'PetChain', type: '' },
      name: 'PetChain',
      ownerAccount: 'personal',
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
    return id;
  } catch {
    return null;
  }
}

// ─── Build event details from appointment ─────────────────────────────────────

function buildEventDetails(appt: Appointment) {
  const startDate = new Date(`${appt.date}T${appt.time ?? '00:00'}:00`);
  const endDate = new Date(startDate.getTime() + (appt.durationMinutes ?? 30) * 60_000);

  return {
    title: appt.title ?? 'Vet Appointment',
    startDate,
    endDate,
    timeZone: appt.timeZone ?? 'UTC',
    location: appt.location ?? '',
    notes: appt.notes ?? '',
    alarms: [
      { relativeOffset: -24 * 60 }, // 24h before
      { relativeOffset: -60 }, // 1h before
    ],
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sync a confirmed appointment to the device calendar.
 * Creates a new event or updates the existing one (idempotent).
 */
export async function syncAppointmentToCalendar(appt: Appointment): Promise<string | null> {
  const granted = await requestCalendarPermission();
  if (!granted) return null;

  const calendarId = await getPetChainCalendarId();
  if (!calendarId) return null;

  try {
    const Calendar = await import('expo-calendar');
    const map = await loadMap();
    const existingEventId = map[appt.id];
    const details = buildEventDetails(appt);

    if (existingEventId) {
      // Update existing event
      await Calendar.updateEventAsync(existingEventId, details);
      return existingEventId;
    }

    // Create new event
    const eventId = await Calendar.createEventAsync(calendarId, details);
    map[appt.id] = eventId;
    await saveMap(map);
    return eventId;
  } catch {
    return null;
  }
}

/**
 * Remove a cancelled/deleted appointment from the device calendar.
 */
export async function removeAppointmentFromCalendar(appointmentId: string): Promise<void> {
  const map = await loadMap();
  const eventId = map[appointmentId];
  if (!eventId) return;

  try {
    const Calendar = await import('expo-calendar');
    await Calendar.deleteEventAsync(eventId);
    delete map[appointmentId];
    await saveMap(map);
  } catch {
    // Ignore — event may already be deleted
  }
}

/**
 * Returns the calendar event ID for an appointment, or null if not synced.
 */
export async function getCalendarEventId(appointmentId: string): Promise<string | null> {
  const map = await loadMap();
  return map[appointmentId] ?? null;
}
