/**
 * Issue #1186 — calendar export service.
 *
 * Covers the main flow (create → update in place → skip when unchanged), the
 * duplicate and stale-data states, permission and server-confirmation denial,
 * the privacy default, and removal / revocation.
 *
 * Everything here is device-local: no test reaches the network, and the
 * server-confirmed flag is only ever passed in as an option.
 */

import { storageKeys } from '../../config/storageKeys';
import { AppointmentStatus, AppointmentType, type Appointment } from '../../models/Appointment';
import {
  DEFAULT_CALENDAR_EXPORT_PREFERENCES,
  GENERIC_EVENT_TITLE,
  PETCHAIN_CALENDAR_TITLE,
  appointmentRevision,
  buildEventDetails,
  exportAppointments,
  getSyncedAppointments,
  loadCalendarPreferences,
  removeAllSyncedAppointments,
  removeSyncedAppointment,
  resolveAppointmentStart,
  revokeCalendarSync,
  saveCalendarPreferences,
  syncAppointmentToCalendar,
} from '../calendarSyncService';

jest.mock('../localDB', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

/**
 * The service pulls in `expo-calendar` and `./localDB` with `await import()` at
 * call time, and `resetModules` gives every test a fresh registry — so both are
 * resolved inside `beforeEach`, which is the generation the service then sees.
 */
type CalendarMock = Record<string, jest.Mock>;

type LocalDBMock = {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

/** Key used before #1186, when only `appointmentId → eventId` was remembered. */
const LEGACY_EVENT_ID_KEY = '@calendarEventIds';

let Calendar: CalendarMock;
let db: LocalDBMock;
let store: Record<string, string>;

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    petId: 'pet-1',
    vetId: 'vet-1',
    date: '2026-06-15',
    time: '10:30',
    type: AppointmentType.ROUTINE_CHECKUP,
    status: AppointmentStatus.CONFIRMED,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    title: 'Annual checkup',
    petName: 'Bella',
    location: 'North Vet Clinic',
    notes: 'Reactive to last sedation — flag for anaesthesia',
    ...overrides,
  };
}

/** Records persisted under `eventRecords`, decoded for assertions. */
function storedRecords(): Record<string, { eventId: string; revision: string }> {
  const raw = store[storageKeys.calendar.eventRecords];
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, { eventId: string; revision: string }>;
}

beforeEach(async () => {
  store = {};
  Calendar = (await import('expo-calendar')) as unknown as CalendarMock;
  db = (await import('../localDB')) as unknown as LocalDBMock;

  db.getItem.mockImplementation(async (key: string) => store[key] ?? null);
  db.setItem.mockImplementation(async (key: string, value: string) => {
    store[key] = value;
  });
  db.removeItem.mockImplementation(async (key: string) => {
    delete store[key];
  });

  // `resetMocks` clears the manual mock's default implementations, so the
  // happy-path calendar module has to be restated for every test.
  Calendar.requestCalendarPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Calendar.getCalendarsAsync.mockResolvedValue([]);
  Calendar.createCalendarAsync.mockResolvedValue('cal-1');
  Calendar.createEventAsync.mockResolvedValue('evt-1');
  Calendar.updateEventAsync.mockResolvedValue(undefined);
  Calendar.deleteEventAsync.mockResolvedValue(undefined);
  Calendar.getEventAsync.mockResolvedValue({ id: 'evt-1' });
  Calendar.getEventsAsync.mockResolvedValue([]);
});

function createdEvents(): { calendarId: string; details: Record<string, unknown> }[] {
  return Calendar.createEventAsync.mock.calls.map(([calendarId, details]) => ({
    calendarId,
    details: details as unknown as Record<string, unknown>,
  }));
}

describe('#1186 export — main flow', () => {
  it('writes one event per selected appointment into the PetChain calendar', async () => {
    const result = await exportAppointments([
      makeAppointment(),
      makeAppointment({ id: 'appt-2', title: 'Dental cleaning' }),
    ]);

    expect(result.created).toBe(2);
    expect(result.blocked).toBeNull();
    expect(createdEvents()).toHaveLength(2);
    expect(createdEvents()[0].calendarId).toBe('cal-1');
    await expect(getSyncedAppointments()).resolves.toHaveLength(2);
  });

  it('creates the dedicated PetChain calendar when the device has none', async () => {
    await exportAppointments([makeAppointment()]);

    expect(Calendar.createCalendarAsync).toHaveBeenCalledWith(
      expect.objectContaining({ title: PETCHAIN_CALENDAR_TITLE }),
    );
  });

  it('reuses an existing PetChain calendar instead of creating a second one', async () => {
    Calendar.getCalendarsAsync.mockResolvedValue([
      { id: 'cal-existing', title: PETCHAIN_CALENDAR_TITLE },
    ]);

    await exportAppointments([makeAppointment()]);

    expect(Calendar.createCalendarAsync).not.toHaveBeenCalled();
    expect(createdEvents()[0].calendarId).toBe('cal-existing');
  });

  it('skips an unchanged appointment instead of writing a duplicate', async () => {
    const appt = makeAppointment();
    await exportAppointments([appt]);
    Calendar.createEventAsync.mockClear();

    const again = await exportAppointments([appt]);

    expect(again.unchanged).toBe(1);
    expect(again.created).toBe(0);
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
    expect(Calendar.updateEventAsync).not.toHaveBeenCalled();
  });

  it('updates the same event in place when the appointment changes', async () => {
    const appt = makeAppointment();
    await exportAppointments([appt]);
    Calendar.createEventAsync.mockClear();

    const moved = { ...appt, time: '14:00' };
    const result = await exportAppointments([moved]);

    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    expect(Calendar.updateEventAsync).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({ startDate: resolveAppointmentStart(moved) }),
    );
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
  });

  it('adopts an event already in the calendar instead of duplicating it', async () => {
    const appt = makeAppointment();
    const details = buildEventDetails(appt, false);
    Calendar.getEventsAsync.mockResolvedValue([
      { id: 'evt-orphan', title: details.title, startDate: details.startDate },
    ]);

    const result = await exportAppointments([appt]);

    expect(result.adopted).toBe(1);
    expect(result.created).toBe(0);
    expect(Calendar.updateEventAsync).toHaveBeenCalledWith('evt-orphan', expect.anything());
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
    expect(storedRecords()['appt-1'].eventId).toBe('evt-orphan');
  });

  it('prunes surplus copies of the same slot while adopting', async () => {
    const appt = makeAppointment();
    const details = buildEventDetails(appt, false);
    Calendar.getEventsAsync.mockResolvedValue([
      { id: 'evt-a', title: details.title, startDate: details.startDate },
      { id: 'evt-b', title: details.title, startDate: details.startDate },
      { id: 'evt-c', title: details.title, startDate: details.startDate },
    ]);

    const result = await exportAppointments([appt]);

    expect(result.adopted).toBe(1);
    expect(Calendar.deleteEventAsync).toHaveBeenCalledTimes(2);
    expect(Calendar.deleteEventAsync).toHaveBeenCalledWith('evt-b');
    expect(storedRecords()['appt-1'].eventId).toBe('evt-a');
  });

  it('ignores events that only look similar when scanning for duplicates', async () => {
    const appt = makeAppointment();
    const details = buildEventDetails(appt, false);
    Calendar.getEventsAsync.mockResolvedValue([
      { id: 'evt-other-title', title: 'Something else', startDate: details.startDate },
      {
        id: 'evt-other-time',
        title: details.title,
        startDate: new Date(details.startDate.getTime() + 60_000),
      },
    ]);

    const result = await exportAppointments([appt]);

    expect(result.created).toBe(1);
    expect(Calendar.deleteEventAsync).not.toHaveBeenCalled();
  });

  it('re-creates an event the user deleted in the calendar app', async () => {
    const appt = makeAppointment();
    await exportAppointments([appt]);
    Calendar.createEventAsync.mockResolvedValue('evt-2');
    // Stale record: the calendar no longer has the event we remember writing.
    Calendar.getEventAsync.mockRejectedValue(new Error('not found'));

    const moved = { ...appt, time: '11:00' };
    const result = await exportAppointments([moved]);

    expect(result.recreated).toBe(1);
    expect(Calendar.updateEventAsync).not.toHaveBeenCalled();
    expect(storedRecords()['appt-1'].eventId).toBe('evt-2');
  });

  it('summarises a mixed selection outcome by outcome', async () => {
    const first = makeAppointment({ id: 'appt-1' });
    const second = makeAppointment({ id: 'appt-2', title: 'Vaccination' });
    await exportAppointments([first, second]);
    Calendar.createEventAsync.mockResolvedValue('evt-3');

    const result = await exportAppointments([
      first,
      second,
      { ...second, id: 'appt-3', title: 'New booking' },
    ]);

    expect(result.unchanged).toBe(2);
    expect(result.created).toBe(1);
    expect(result.items.find((item) => item.appointmentId === 'appt-3')?.eventId).toBe('evt-3');
  });
});

describe('#1186 export — privacy', () => {
  it('keeps the pet name and notes out of exported events by default', async () => {
    const appt = makeAppointment();
    await exportAppointments([appt]);

    const [event] = createdEvents();
    expect(event.details.title).toBe(appt.title);
    expect(event.details.title).not.toContain('Bella');
    expect(event.details.notes).toBe('');
    expect(JSON.stringify(event.details)).not.toContain('sedation');
  });

  it('falls back to a generic title when the appointment has none', async () => {
    await exportAppointments([makeAppointment({ title: '' })]);

    expect(createdEvents()[0].details.title).toBe(GENERIC_EVENT_TITLE);
  });

  it('includes pet detail only once that opt-in is on', async () => {
    const appt = makeAppointment();
    await exportAppointments([appt], { includePetDetails: true });

    const [event] = createdEvents();
    expect(event.details.title).toBe(`${appt.title} — Bella`);
    expect(event.details.notes).toBe(appt.notes);
  });

  it('keeps the clinic location even when pet detail is off', async () => {
    await exportAppointments([makeAppointment()]);

    expect(createdEvents()[0].details.location).toBe('North Vet Clinic');
  });

  it('rewrites an existing event when the privacy opt-in changes', async () => {
    const appt = makeAppointment();
    await exportAppointments([appt]);
    expect((await exportAppointments([appt])).unchanged).toBe(1);

    const result = await exportAppointments([appt], { includePetDetails: true });

    expect(result.updated).toBe(1);
    expect(Calendar.updateEventAsync).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({ notes: appt.notes }),
    );
  });

  it('does not sync a booking until the user opts in', async () => {
    await expect(syncAppointmentToCalendar(makeAppointment())).resolves.toBeNull();
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
  });

  it('syncs bookings once export is enabled', async () => {
    await saveCalendarPreferences({ syncEnabled: true });

    await expect(syncAppointmentToCalendar(makeAppointment())).resolves.toBe('evt-1');
    expect((await loadCalendarPreferences()).syncEnabled).toBe(true);
  });

  it('turns on the opt-in when the user exports a deliberate selection', async () => {
    expect(DEFAULT_CALENDAR_EXPORT_PREFERENCES.syncEnabled).toBe(false);
    await exportAppointments([makeAppointment()], { explicitSelection: true });

    expect((await loadCalendarPreferences()).syncEnabled).toBe(true);
  });

  it('leaves the opt-in untouched for a background sync', async () => {
    await exportAppointments([makeAppointment()]);

    expect((await loadCalendarPreferences()).syncEnabled).toBe(false);
  });

  it('revises legacy pet-identifying events privately instead of duplicating them', async () => {
    store[LEGACY_EVENT_ID_KEY] = JSON.stringify({ 'appt-1': 'evt-legacy' });
    const appt = makeAppointment();

    const result = await exportAppointments([appt]);

    expect(result.updated).toBe(1);
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
    expect(Calendar.updateEventAsync).toHaveBeenCalledWith(
      'evt-legacy',
      expect.objectContaining({ title: appt.title, notes: '' }),
    );
  });
});

describe('#1186 export — denial and stale-data states', () => {
  it('writes nothing when calendar access is denied', async () => {
    Calendar.requestCalendarPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const result = await exportAppointments([makeAppointment()], { explicitSelection: true });

    expect(result.blocked).toBe('permission_denied');
    expect(result.items[0].outcome).toBe('permission_denied');
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
    expect((await loadCalendarPreferences()).syncEnabled).toBe(false);
  });

  it('does not prompt for calendar access before the server confirms the feature', async () => {
    const result = await exportAppointments([makeAppointment()], { serverConfirmed: false });

    expect(result.blocked).toBe('server_unconfirmed');
    expect(result.items).toHaveLength(0);
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
  });

  it('reports failure rather than empty success when no calendar can be provided', async () => {
    Calendar.getCalendarsAsync.mockRejectedValue(new Error('provider error'));
    Calendar.createCalendarAsync.mockRejectedValue(new Error('provider error'));

    const result = await exportAppointments([makeAppointment()]);

    expect(result.failed).toBe(1);
    expect(result.blocked).toBeNull();
    expect(result.created).toBe(0);
  });

  it('fails one appointment without aborting the rest of the selection', async () => {
    Calendar.createEventAsync
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValue('evt-ok');

    const result = await exportAppointments([
      makeAppointment({ id: 'appt-1' }),
      makeAppointment({ id: 'appt-2' }),
    ]);

    expect(result.failed).toBe(1);
    expect(result.created).toBe(1);
    expect(result.items[0].outcome).toBe('failed');
  });

  it('drops unreadable stored records and re-adopts the events', async () => {
    store[storageKeys.calendar.eventRecords] = '{not valid json';
    store[LEGACY_EVENT_ID_KEY] = 'also not valid json';

    const result = await exportAppointments([makeAppointment()]);

    expect(result.created).toBe(1);
    expect(storedRecords()).toHaveProperty('appt-1');
  });

  it('ignores malformed record entries', async () => {
    store[storageKeys.calendar.eventRecords] = JSON.stringify({
      'appt-1': { eventId: '' },
      'appt-2': null,
      'appt-3': { eventId: 'evt-3', revision: 42 },
    });

    await exportAppointments([makeAppointment({ id: 'appt-3' })]);

    expect(createdEvents()).toHaveLength(0);
    const expected = appointmentRevision(makeAppointment({ id: 'appt-3' }), false);
    expect(storedRecords()['appt-3'].revision).toBe(expected);
  });
});

describe('#1186 export — boundaries', () => {
  it('returns an empty result for an empty selection', async () => {
    const result = await exportAppointments([]);

    expect(result.items).toHaveLength(0);
    expect(result.blocked).toBeNull();
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
  });

  it('fails an appointment with no id instead of writing an untracked event', async () => {
    const result = await exportAppointments([makeAppointment({ id: '' })]);

    expect(result.failed).toBe(1);
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
  });

  it('composes the clock time onto a bare server date', () => {
    const start = resolveAppointmentStart(makeAppointment());

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(5);
    expect(start.getDate()).toBe(15);
    expect(start.getHours()).toBe(10);
    expect(start.getMinutes()).toBe(30);
  });

  it('keeps a full ISO datetime as written', () => {
    const start = resolveAppointmentStart(
      makeAppointment({ date: '2026-06-15T07:15:00.000Z', time: '10:30' }),
    );

    expect(start.toISOString()).toBe('2026-06-15T07:15:00.000Z');
  });

  it('anchors an unusable date to today instead of producing an invalid event', () => {
    const start = resolveAppointmentStart(makeAppointment({ date: '10:30' }));
    const today = new Date();

    expect(Number.isNaN(start.getTime())).toBe(false);
    expect(start.getDate()).toBe(today.getDate());
    expect(start.getHours()).toBe(10);
  });

  it('defaults the clock when the time is missing or out of range', () => {
    expect(resolveAppointmentStart(makeAppointment({ time: '' })).getHours()).toBe(9);
    expect(resolveAppointmentStart(makeAppointment({ time: '25:99' })).getHours()).toBe(9);
    expect(resolveAppointmentStart(makeAppointment({ time: '08:75' })).getMinutes()).toBe(0);
  });

  it('uses the appointment duration, falling back to the default', () => {
    const details = buildEventDetails(makeAppointment({ durationMinutes: 75 }), false);
    expect(details.endDate.getTime() - details.startDate.getTime()).toBe(75 * 60_000);

    const fallback = buildEventDetails(makeAppointment({ durationMinutes: 0 }), false);
    expect(fallback.endDate.getTime() - fallback.startDate.getTime()).toBe(30 * 60_000);
  });

  it('defaults preferences to not opted in when storage is unreadable', async () => {
    db.getItem.mockRejectedValue(new Error('decryption failed'));

    expect(await loadCalendarPreferences()).toEqual(DEFAULT_CALENDAR_EXPORT_PREFERENCES);
  });

  it('survives a failed preference write', async () => {
    db.setItem.mockImplementation(async (key: string, value: string) => {
      if (key === storageKeys.calendar.exportPreferences) throw new Error('storage full');
      store[key] = value;
    });

    await expect(saveCalendarPreferences({ includePetDetails: true })).resolves.toEqual({
      syncEnabled: false,
      includePetDetails: true,
    });
  });
});

describe('#1186 removal and revocation', () => {
  it('deletes the event and forgets the record', async () => {
    await exportAppointments([makeAppointment()]);

    await expect(removeSyncedAppointment('appt-1')).resolves.toBe('removed');
    expect(Calendar.deleteEventAsync).toHaveBeenCalledWith('evt-1');
    await expect(getSyncedAppointments()).resolves.toHaveLength(0);
  });

  it('clears a record whose event was already deleted in the calendar app', async () => {
    await exportAppointments([makeAppointment()]);
    Calendar.getEventAsync.mockResolvedValue(null);

    await expect(removeSyncedAppointment('appt-1')).resolves.toBe('already_gone');
    expect(Calendar.deleteEventAsync).not.toHaveBeenCalled();
    await expect(getSyncedAppointments()).resolves.toHaveLength(0);
  });

  it('keeps the record when the calendar refuses the delete so it can be retried', async () => {
    await exportAppointments([makeAppointment()]);
    Calendar.deleteEventAsync.mockRejectedValue(new Error('provider error'));

    await expect(removeSyncedAppointment('appt-1')).resolves.toBe('failed');
    await expect(getSyncedAppointments()).resolves.toHaveLength(1);
  });

  it('reports not_synced for an appointment we never wrote', async () => {
    await expect(removeSyncedAppointment('appt-unknown')).resolves.toBe('not_synced');
    expect(Calendar.deleteEventAsync).not.toHaveBeenCalled();
  });

  it('removes every synced event offline, without any server confirmation', async () => {
    await exportAppointments([
      makeAppointment({ id: 'appt-1' }),
      makeAppointment({ id: 'appt-2' }),
    ]);
    Calendar.deleteEventAsync
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('provider error'));

    const summary = await removeAllSyncedAppointments();

    expect(summary).toEqual({ removed: 1, alreadyGone: 0, failed: 1 });
    await expect(getSyncedAppointments()).resolves.toHaveLength(1);
  });

  it('revokes sync: removes events, forgets records and turns both opt-ins off', async () => {
    await saveCalendarPreferences({ syncEnabled: true, includePetDetails: true });
    await exportAppointments([makeAppointment()]);

    const summary = await revokeCalendarSync();

    expect(summary.removed).toBe(1);
    await expect(getSyncedAppointments()).resolves.toHaveLength(0);
    expect(await loadCalendarPreferences()).toEqual(DEFAULT_CALENDAR_EXPORT_PREFERENCES);
  });

  it('clears the legacy event-id cache on revoke', async () => {
    store[LEGACY_EVENT_ID_KEY] = JSON.stringify({ 'appt-1': 'evt-legacy' });

    await revokeCalendarSync();

    expect(db.removeItem).toHaveBeenCalledWith(LEGACY_EVENT_ID_KEY);
  });
});
