/**
 * Deterministic timezone fixtures for recurring appointment reminders (#1060).
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
 * Booking confirmation conflict fixtures (#1062).
 *
 * A slot can become unavailable between selection and confirmation. These
 * fixtures pin the client contract for that race:
 *  - confirmation requests carry a stable idempotency key so double taps and
 *    retries reconcile to at most one booking attempt;
 *  - a server conflict maps to a dedicated UI state, never a success state;
 *  - entered notes and the selected pet survive the availability refresh.
 */
export type BookingConfirmationState =
  | 'idle'
  | 'submitting'
  | 'success'
  | 'conflict'
  | 'network-error';

export interface BookingDraft {
  slotId: string;
  petId: string;
  notes: string;
}

export interface BookingConfirmationFixture {
  name: string;
  draft: BookingDraft;
  /** Idempotency key generated once per booking attempt. */
  idempotencyKey: string;
  /** Simulated server outcome for the confirmation request. */
  serverOutcome: 'ok' | 'conflict' | 'timeout';
  /** Number of confirmation requests the client is expected to issue. */
  expectedRequestCount: number;
  /** UI state the client must land in. */
  expectedState: BookingConfirmationState;
  /** Whether the success state may be shown. */
  expectedSuccess: boolean;
  /** Draft fields that must remain available after the outcome. */
  expectedRetained: Array<keyof BookingDraft>;
}

export const BOOKING_CONFIRMATION_FIXTURES: BookingConfirmationFixture[] = [
  {
    name: 'double tap issues a single booking attempt',
    draft: { slotId: 'slot-1', petId: 'pet-1', notes: 'annual checkup' },
    idempotencyKey: 'idem-double-tap',
    serverOutcome: 'ok',
    expectedRequestCount: 1,
    expectedState: 'success',
    expectedSuccess: true,
    expectedRetained: ['slotId', 'petId', 'notes'],
  },
  {
    name: 'server conflict maps to conflict state, never success',
    draft: { slotId: 'slot-1', petId: 'pet-1', notes: 'annual checkup' },
    idempotencyKey: 'idem-conflict',
    serverOutcome: 'conflict',
    expectedRequestCount: 1,
    expectedState: 'conflict',
    expectedSuccess: false,
    expectedRetained: ['petId', 'notes'],
  },
  {
    name: 'timeout retry reconciles by idempotency key',
    draft: { slotId: 'slot-1', petId: 'pet-1', notes: 'annual checkup' },
    idempotencyKey: 'idem-timeout',
    serverOutcome: 'timeout',
    expectedRequestCount: 2,
    expectedState: 'network-error',
    expectedSuccess: false,
    expectedRetained: ['slotId', 'petId', 'notes'],
  },
];
