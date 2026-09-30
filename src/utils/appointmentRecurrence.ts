/**
 * Timezone-aware recurrence utilities for appointment reminders.
 *
 * Recurrence occurrences are computed in the appointment's own timezone
 * (not the device timezone) so that travel and DST transitions produce
 * deterministic next-fire times.
 */

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** Interval between occurrences, e.g. every 2 weeks. Defaults to 1. */
  interval?: number;
  /** ISO weekday numbers (1 = Monday .. 7 = Sunday) for weekly rules. */
  byWeekday?: number[];
  /** Day of month (1-31) for monthly rules. */
  byMonthDay?: number;
  /** Inclusive end of the recurrence, as an ISO date-time string. */
  until?: string;
  /** Number of occurrences to generate, including the first. */
  count?: number;
}

/**
 * A local wall-clock time within a specific IANA timezone.
 * `localTime` is an ISO-like string without a zone, e.g. "2024-03-10T02:30:00".
 */
export interface ZonedLocalTime {
  localTime: string;
  timeZone: string;
}

/**
 * Deterministic resolution for local times that do not exist (DST gap) or
 * occur twice (DST overlap).
 *
 * - `gap`: the wall-clock time is skipped; fire at the instant the clock
 *   jumps forward (the start of the gap).
 * - `overlap`: the wall-clock time occurs twice; always fire on the first
 *   (earlier) occurrence so the reminder is not duplicated.
 */
export const DST_GAP_POLICY = 'forward' as const;
export const DST_OVERLAP_POLICY = 'first' as const;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/**
 * Returns the UTC offset (in minutes) of `timeZone` at the given instant.
 * Positive values are east of UTC.
 */
function getOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = parseInt(part.value, 10);
    }
  }
  const asUTC = Date.UTC(
    map.year,
    (map.month ?? 1) - 1,
    map.day ?? 1,
    map.hour === 24 ? 0 : map.hour ?? 0,
    map.minute ?? 0,
    map.second ?? 0,
  );
  return Math.round((asUTC - date.getTime()) / MS_PER_MINUTE);
}

/**
 * Converts a wall-clock time in `timeZone` to a UTC instant, applying the
 * deterministic DST policies above.
 */
export function zonedLocalTimeToUtc({ localTime, timeZone }: ZonedLocalTime): Date {
  const [datePart, timePart = '00:00:00'] = localTime.split('T');
  const [year, month, day] = datePart.split('-').map((v) => parseInt(v, 10));
  const [hour, minute, second = 0] = timePart.split(':').map((v) => parseInt(v, 10));

  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  // First guess: treat the wall-clock time as if it were UTC, then correct by
  // the offset observed at that instant. Iterate once to settle on the offset
  // that actually applies at the resolved instant.
  let guess = naiveUtc - getOffsetMinutes(timeZone, new Date(naiveUtc)) * MS_PER_MINUTE;
  guess = naiveUtc - getOffsetMinutes(timeZone, new Date(guess)) * MS_PER_MINUTE;

  const resolved = new Date(guess);
  const resolvedLocal = formatInTimeZone(resolved, timeZone);

  if (resolvedLocal === localTime) {
    return resolved;
  }

  // The wall-clock time does not exist (DST gap). Fire at the start of the
  // gap: the instant the clock jumps forward.
  const gapStart = new Date(naiveUtc - getOffsetMinutes(timeZone, new Date(naiveUtc)) * MS_PER_MINUTE);
  const beforeGap = new Date(gapStart.getTime() - MS_PER_MINUTE);
  const offsetBefore = getOffsetMinutes(timeZone, beforeGap);
  const offsetAfter = getOffsetMinutes(timeZone, gapStart);
  if (offsetAfter > offsetBefore) {
    return new Date(naiveUtc - offsetBefore * MS_PER_MINUTE);
  }

  // The wall-clock time occurs twice (DST overlap). Always use the first
  // (earlier) occurrence so the reminder is not duplicated.
  const earlier = new Date(naiveUtc - Math.max(offsetBefore, offsetAfter) * MS_PER_MINUTE);
  return earlier;
}

/** Formats a UTC instant as a wall-clock string in the given timezone. */
export function formatInTimeZone(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}`;
}

/** Adds `days` calendar days to a wall-clock date string, preserving time. */
function addDays(localTime: string, days: number): string {
  const [datePart, timePart = '00:00:00'] = localTime.split('T');
  const [year, month, day] = datePart.split('-').map((v) => parseInt(v, 10));
  const base = Date.UTC(year, month - 1, day);
  const next = new Date(base + days * MS_PER_DAY);
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, '0');
  const d = String(next.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}T${timePart}`;
}

/** Adds `months` calendar months to a wall-clock date string, preserving time. */
function addMonths(localTime: string, months: number): string {
  const [datePart, timePart = '00:00:00'] = localTime.split('T');
  const [year, month, day] = datePart.split('-').map((v) => parseInt(v, 10));
  const targetMonth = month - 1 + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInMonth);
  const y = targetYear;
  const m = String(normalizedMonth + 1).padStart(2, '0');
  const d = String(clampedDay).padStart(2, '0');
  return `${y}-${m}-${d}T${timePart}`;
}

/**
 * Computes the next occurrence after `after` for a recurrence anchored at
 * `start` in the appointment's timezone. Returns `null` when the rule is
 * exhausted (past `until` or `count`).
 */
export function nextOccurrence(
  start: ZonedLocalTime,
  rule: RecurrenceRule,
  after: Date,
): Date | null {
  const interval = Math.max(1, rule.interval ?? 1);
  const until = rule.until ? new Date(rule.until) : null;
  const maxCount = rule.count ?? Number.POSITIVE_INFINITY;

  let index = 0;
  let candidateLocal = start.localTime;

  while (index < maxCount) {
    const candidate = zonedLocalTimeToUtc({ localTime: candidateLocal, timeZone: start.timeZone });
    if (candidate.getTime() > after.getTime()) {
      if (until && candidate.getTime() > until.getTime()) {
        return null;
      }
      return candidate;
    }
    index += 1;
    if (rule.frequency === 'daily') {
      candidateLocal = addDays(candidateLocal, interval);
    } else if (rule.frequency === 'weekly') {
      candidateLocal = addDays(candidateLocal, 7 * interval);
    } else {
      candidateLocal = addMonths(candidateLocal, interval);
    }
  }

  return null;
}

/**
 * Generates up to `limit` occurrences starting after `after`, all resolved in
 * the appointment's timezone. Device timezone is intentionally ignored.
 */
export function upcomingOccurrences(
  start: ZonedLocalTime,
  rule: RecurrenceRule,
  after: Date,
  limit = 10,
): Date[] {
  const results: Date[] = [];
  let cursor = after;
  for (let i = 0; i < limit; i += 1) {
    const next = nextOccurrence(start, rule, cursor);
    if (!next) {
      break;
    }
    results.push(next);
    cursor = next;
  }
  return results;
}

/**
 * Returns true when the appointment timezone differs from the device timezone,
 * so the UI can surface the appointment timezone explicitly.
 */
export function shouldShowAppointmentTimeZone(
  appointmentTimeZone: string,
  deviceTimeZone: string,
): boolean {
  return appointmentTimeZone !== deviceTimeZone;
}
