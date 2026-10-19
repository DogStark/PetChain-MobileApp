/**
 * Deterministic timezone fixtures for recurring appointment reminders (#1060)
 * and configurable medication reminder schedules (#1140).
 *
 * These fixtures pin the expected next-fire times for recurrences that cross
 * DST gaps (skipped local times) and DST overlaps (repeated local times), as
 * well as travel and locale changes. They are intentionally timezone-aware:
 * occurrences are computed in the appointment's own timezone, not the device
 * timezone, so a device timezone change must not duplicate or drop an
 * occurrence.
 *
 * The fixtures are pure data + assertions so they can be consumed by the
 * notification scheduling tests with fake timers without depending on the
 * host machine's timezone.
 */

export type RecurrenceRule =
  | { frequency: 'daily'; interval?: number }
  | { frequency: 'weekly'; interval?: number; byDay?: number[] }
  | { frequency: 'monthly'; interval?: number; dayOfMonth?: number };

export interface AppointmentFixture {
  id: string;
  /** IANA timezone the appointment was created in. Persisted with the appointment. */
  timezone: string;
  /** Local wall-clock start time in the appointment timezone, ISO-like. */
  startLocal: string;
  recurrence: RecurrenceRule;
}

export interface OccurrenceExpectation {
  /** UTC instant the occurrence should fire, as an ISO string. */
  fireAtUtc: string;
  /** Local wall-clock time in the appointment timezone. */
  localTime: string;
  /** How a skipped/repeated local time was resolved. */
  resolution: 'exact' | 'gap-shifted-forward' | 'overlap-first';
}

/**
 * Resolve a local wall-clock time in a given IANA timezone to a UTC instant.
 *
 * Deterministic rules for ambiguous/nonexistent local times:
 *  - DST gap (skipped local time): shift forward by the gap duration so the
 *    occurrence still fires exactly once.
 *  - DST overlap (repeated local time): pick the first (earlier) instant so the
 *    occurrence fires exactly once.
 *
 * This mirrors the timezone-aware library behavior used by the scheduler and
 * keeps the fixtures independent of the device timezone.
 */
export function resolveLocalToUtc(
  localIso: string,
  timezone: string,
): { fireAtUtc: string; resolution: OccurrenceExpectation['resolution'] } {
  const [datePart, timePart] = localIso.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);

  // Candidate UTC instants for the same wall-clock time, one per offset.
  const candidates = candidateOffsets(timezone, year, month, day).map((offsetMinutes) =>
    Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000,
  );

  const valid = candidates.filter((utc) => {
    const back = new Date(utc);
    return localPartsInZone(back, timezone) === localIso;
  });

  if (valid.length === 0) {
    // DST gap: no instant maps to this wall-clock time. Shift forward by the
    // gap duration (the difference between the two candidate offsets).
    const gapMinutes = Math.abs(candidates[0] - candidates[1]) / 60_000;
    const shifted = Math.min(...candidates) + gapMinutes * 60_000;
    return { fireAtUtc: new Date(shifted).toISOString(), resolution: 'gap-shifted-forward' };
  }

  if (valid.length > 1) {
    // DST overlap: pick the first (earlier) instant.
    return { fireAtUtc: new Date(Math.min(...valid)).toISOString(), resolution: 'overlap-first' };
  }

  return { fireAtUtc: new Date(valid[0]).toISOString(), resolution: 'exact' };
}

function candidateOffsets(timezone: string, year: number, month: number, day: number): number[] {
  // Standard and daylight offsets for the zone, in minutes east of UTC.
  const jan = zoneOffsetMinutes(timezone, Date.UTC(year, 0, 1));
  const jul = zoneOffsetMinutes(timezone, Date.UTC(year, 6, 1));
  return jan === jul ? [jan] : [jan, jul];
}

function zoneOffsetMinutes(timezone: string, utcMillis: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMillis));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
  );
  return (asUtc - utcMillis) / 60_000;
}

function localPartsInZone(date: Date, timezone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = String(Number(get('hour')) % 24).padStart(2, '0');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/**
 * Fixtures covering DST gap/overlap, travel, and locale changes. Each fixture
 * asserts the deterministic next-fire time in the appointment timezone.
 */
export const RECURRENCE_FIXTURES: Array<{
  name: string;
  appointment: AppointmentFixture;
  /** Device timezone at scheduling time; must not affect the result. */
  deviceTimezone: string;
  expected: OccurrenceExpectation;
}> = [
  {
    name: 'DST gap: 02:30 does not exist on spring-forward day',
    appointment: {
      id: 'appt-dst-gap',
      timezone: 'America/New_York',
      startLocal: '2024-03-10T02:30',
      recurrence: { frequency: 'daily' },
    },
    deviceTimezone: 'America/New_York',
    expected: {
      fireAtUtc: '2024-03-10T07:30:00.000Z',
      localTime: '2024-03-10T03:30',
      resolution: 'gap-shifted-forward',
    },
  },
  {
    name: 'DST overlap: 01:30 occurs twice on fall-back day',
    appointment: {
      id: 'appt-dst-overlap',
      timezone: 'America/New_York',
      startLocal: '2024-11-03T01:30',
      recurrence: { frequency: 'daily' },
    },
    deviceTimezone: 'America/New_York',
    expected: {
      fireAtUtc: '2024-11-03T05:30:00.000Z',
      localTime: '2024-11-03T01:30',
      resolution: 'overlap-first',
    },
  },
  {
    name: 'Travel: device in Tokyo, appointment stays in New York',
    appointment: {
      id: 'appt-travel',
      timezone: 'America/New_York',
      startLocal: '2024-06-15T09:00',
      recurrence: { frequency: 'weekly', byDay: [6] },
    },
    deviceTimezone: 'Asia/Tokyo',
    expected: {
      fireAtUtc: '2024-06-15T13:00:00.000Z',
      localTime: '2024-06-15T09:00',
      resolution: 'exact',
    },
  },
  {
    name: 'Locale change: device in London, appointment stays in New York',
    appointment: {
      id: 'appt-locale',
      timezone: 'America/New_York',
      startLocal: '2024-06-15T09:00',
      recurrence: { frequency: 'weekly', byDay: [6] },
    },
    deviceTimezone: 'Europe/London',
    expected: {
      fireAtUtc: '2024-06-15T13:00:00.000Z',
      localTime: '2024-06-15T09:00',
      resolution: 'exact',
    },
  },
];

/**
 * Recurrence edits must preserve the appointment timezone and recompute the
 * next-fire time deterministically from the new rule.
 */
export const RECURRENCE_EDIT_FIXTURES: Array<{
  name: string;
  before: AppointmentFixture;
  after: AppointmentFixture;
  expectedTimezone: string;
}> = [
  {
    name: 'edit recurrence keeps original timezone',
    before: {
      id: 'appt-edit',
      timezone: 'America/Los_Angeles',
      startLocal: '2024-03-10T02:30',
      recurrence: { frequency: 'daily' },
    },
    after: {
      id: 'appt-edit',
      timezone: 'America/Los_Angeles',
      startLocal: '2024-03-10T02:30',
      recurrence: { frequency: 'weekly', byDay: [0] },
    },
    expectedTimezone: 'America/Los_Angeles',
  },
];

/**
 * Configurable medication reminder schedules (#1140).
 *
 * A schedule supports multiple daily times, selected weekdays, start/end dates,
 * and a persisted IANA timezone. Occurrences are computed in the schedule's own
 * timezone so a device timezone change does not duplicate or drop a dose.
 */
export interface MedicationSchedule {
  id: string;
  /** IANA timezone the schedule was created in. Persisted with the schedule. */
  timezone: string;
  /** Local wall-clock reminder times, e.g. ['08:00', '20:00']. */
  times: string[];
  /** Selected weekdays, 0 = Sunday ... 6 = Saturday. Empty means every day. */
  weekdays: number[];
  /** Inclusive local start date, YYYY-MM-DD. */
  startDate: string;
  /** Inclusive local end date, YYYY-MM-DD. Null means no end. */
  endDate: string | null;
}

/**
 * Compute the next-fire UTC instants for a medication schedule on a given local
 * date, honoring selected weekdays and the inclusive start/end date window.
 * Returns an empty array when the date is outside the window or not selected.
 */
export function medicationOccurrencesForDate(
  schedule: MedicationSchedule,
  localDate: string,
): OccurrenceExpectation[] {
  if (localDate < schedule.startDate) return [];
  if (schedule.endDate !== null && localDate > schedule.endDate) return [];

  const weekday = weekdayOf(localDate);
  if (schedule.weekdays.length > 0 && !schedule.weekdays.includes(weekday)) return [];

  return schedule.times.map((time) => {
    const { fireAtUtc, resolution } = resolveLocalToUtc(
      `${localDate}T${time}`,
      schedule.timezone,
    );
    return { fireAtUtc, localTime: `${localDate}T${time}`, resolution };
  });
}

function weekdayOf(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export const MEDICATION_SCHEDULE_FIXTURES: Array<{
  name: string;
  schedule: MedicationSchedule;
  /** Device timezone at scheduling time; must not affect the result. */
  deviceTimezone: string;
  localDate: string;
  expected: OccurrenceExpectation[];
}> = [
  {
    name: 'multiple daily times fire in the schedule timezone',
    schedule: {
      id: 'med-multi',
      timezone: 'America/New_York',
      times: ['08:00', '20:00'],
      weekdays: [],
      startDate: '2024-06-01',
      endDate: null,
    },
    deviceTimezone: 'Asia/Tokyo',
    localDate: '2024-06-15',
    expected: [
      { fireAtUtc: '2024-06-15T12:00:00.000Z', localTime: '2024-06-15T08:00', resolution: 'exact' },
      { fireAtUtc: '2024-06-16T00:00:00.000Z', localTime: '2024-06-15T20:00', resolution: 'exact' },
    ],
  },
  {
    name: 'unselected weekday produces no occurrences',
    schedule: {
      id: 'med-weekdays',
      timezone: 'America/New_York',
      times: ['09:00'],
      weekdays: [1, 3, 5],
      startDate: '2024-06-01',
      endDate: null,
    },
    deviceTimezone: 'America/New_York',
    localDate: '2024-06-16',
    expected: [],
  },
  {
    name: 'selected weekday produces occurrences',
    schedule: {
      id: 'med-weekdays',
      timezone: 'America/New_York',
      times: ['09:00'],
      weekdays: [1, 3, 5],
      startDate: '2024-06-01',
      endDate: null,
    },
    deviceTimezone: 'America/New_York',
    localDate: '2024-06-17',
    expected: [
      { fireAtUtc: '2024-06-17T13:00:00.000Z', localTime: '2024-06-17T09:00', resolution: 'exact' },
    ],
  },
  {
    name: 'date before start date produces no occurrences',
    schedule: {
      id: 'med-window',
      timezone: 'America/New_York',
      times: ['08:00'],
      weekdays: [],
      startDate: '2024-06-10',
      endDate: '2024-06-20',
    },
    deviceTimezone: 'America/New_York',
    localDate: '2024-06-09',
    expected: [],
  },
  {
    name: 'date after end date produces no occurrences',
    schedule: {
      id: 'med-window',
      timezone: 'America/New_York',
      times: ['08:00'],
      weekdays: [],
      startDate: '2024-06-10',
      endDate: '2024-06-20',
    },
    deviceTimezone: 'America/New_York',
    localDate: '2024-06-21',
    expected: [],
  },
  {
    name: 'end date is inclusive',
    schedule: {
      id: 'med-window',
      timezone: 'America/New_York',
      times: ['08:00'],
      weekdays: [],
      startDate: '2024-06-10',
      endDate: '2024-06-20',
    },
    deviceTimezone: 'America/New_York',
    localDate: '2024-06-20',
    expected: [
      { fireAtUtc: '2024-06-20T12:00:00.000Z', localTime: '2024-06-20T08:00', resolution: 'exact' },
    ],
  },
  {
    name: 'timezone change: device in London, schedule stays in New York',
    schedule: {
      id: 'med-tz',
      timezone: 'America/New_York',
      times: ['08:00'],
      weekdays: [],
      startDate: '2024-06-01',
      endDate: null,
    },
    deviceTimezone: 'Europe/London',
    localDate: '2024-06-15',
    expected: [
      { fireAtUtc: '2024-06-15T12:00:00.000Z', localTime: '2024-06-15T08:00', resolution: 'exact' },
    ],
  },
  {
    name: 'DST gap: 02:30 dose shifts forward on spring-forward day',
    schedule: {
      id: 'med-dst-gap',
      timezone: 'America/New_York',
      times: ['02:30'],
      weekdays: [],
      startDate: '2024-03-01',
      endDate: null,
    },
    deviceTimezone: 'America/New_York',
    localDate: '2024-03-10',
    expected: [
      { fireAtUtc: '2024-03-10T07:30:00.000Z', localTime: '2024-03-10T02:30', resolution: 'gap-shifted-forward' },
    ],
  },
  {
    name: 'DST overlap: 01:30 dose fires once on fall-back day',
    schedule: {
      id: 'med-dst-overlap',
      timezone: 'America/New_York',
      times: ['01:30'],
      weekdays: [],
      startDate: '2024-11-01',
      endDate: null,
    },
    deviceTimezone: 'America/New_York',
    localDate: '2024-11-03',
    expected: [
      { fireAtUtc: '2024-11-03T05:30:00.000Z', localTime: '2024-11-03T01:30', resolution: 'overlap-first' },
    ],
  },
];
