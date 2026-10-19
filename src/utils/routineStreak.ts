export type RoutineDayState = 'completed' | 'skipped' | 'unknown';

export interface RoutineDay {
  date: string;
  state: RoutineDayState;
  eventCount: number;
}

export interface RoutineStreakSummary {
  currentStreak: number;
  longestStreak: number;
  completedDays: number;
  skippedDays: number;
  unknownDays: number;
  referenceDate: string;
}

export interface RawRoutineEvent {
  date: string;
  status?: string | null;
  confirmed?: boolean | null;
  serverConfirmed?: boolean | null;
}

export interface RawRoutineDay {
  date: string;
  events?: RawRoutineEvent[] | null;
  confirmed?: boolean | null;
  serverConfirmed?: boolean | null;
  state?: string | null;
}

export interface MonthGridCell {
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
}

export interface MonthGrid {
  year: number;
  month: number;
  cells: MonthGridCell[];
  firstDate: string;
  lastDate: string;
}

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function isValidDateKey(date: string): boolean {
  const match = DATE_RE.exec(date);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

export function parseDateKey(date: string): { year: number; month: number; day: number } | null {
  if (!isValidDateKey(date)) return null;
  const match = DATE_RE.exec(date)!;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function addDays(date: string, delta: number): string {
  const parsed = parseDateKey(date);
  if (!parsed) return date;
  const base = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  base.setUTCDate(base.getUTCDate() + delta);
  return toDateKey(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}

function normalizeStatus(status: string | null | undefined): RoutineDayState | null {
  if (!status) return null;
  const value = status.trim().toLowerCase();
  if (value === 'completed' || value === 'complete' || value === 'done') return 'completed';
  if (value === 'skipped' || value === 'skip') return 'skipped';
  if (value === 'unknown' || value === 'pending' || value === 'missing') return 'unknown';
  return null;
}

function isConfirmed(event: RawRoutineEvent): boolean {
  if (event.confirmed === false) return false;
  if (event.serverConfirmed === false) return false;
  if (event.confirmed === true || event.serverConfirmed === true) return true;
  // Absence of explicit confirmation flags is treated as server-confirmed
  // only when a status is present; otherwise the event is not usable.
  return event.status != null;
}

/**
 * Maps server-confirmed routine events for a single day to a RoutineDayState.
 * Returns 'unknown' when no server-confirmed data exists. Never returns
 * 'skipped' for missing data.
 */
export function classifyRoutineDay(raw: RawRoutineDay | null | undefined): RoutineDay {
  const date = raw?.date ?? '';
  if (!raw) {
    return { date, state: 'unknown', eventCount: 0 };
  }

  const events = Array.isArray(raw.events) ? raw.events : [];
  const confirmedEvents = events.filter((event) => event && isConfirmed(event));

  if (confirmedEvents.length === 0) {
    // Fall back to a day-level confirmed status if provided.
    const dayConfirmed =
      raw.confirmed === true ||
      raw.serverConfirmed === true ||
      (raw.confirmed !== false && raw.serverConfirmed !== false && raw.state != null);
    const dayState = dayConfirmed ? normalizeStatus(raw.state) : null;
    if (dayState === 'completed' || dayState === 'skipped') {
      return { date, state: dayState, eventCount: 0 };
    }
    return { date, state: 'unknown', eventCount: 0 };
  }

  let completed = 0;
  let skipped = 0;
  for (const event of confirmedEvents) {
    const state = normalizeStatus(event.status);
    if (state === 'completed') completed += 1;
    else if (state === 'skipped') skipped += 1;
  }

  if (completed > 0) {
    return { date, state: 'completed', eventCount: confirmedEvents.length };
  }
  if (skipped > 0) {
    return { date, state: 'skipped', eventCount: confirmedEvents.length };
  }
  return { date, state: 'unknown', eventCount: confirmedEvents.length };
}

function indexDays(days: RoutineDay[]): Map<string, RoutineDay> {
  const map = new Map<string, RoutineDay>();
  for (const day of days) {
    if (day && day.date) map.set(day.date, day);
  }
  return map;
}

/**
 * Walks backwards from the reference date counting consecutive 'completed'
 * days. 'skipped' breaks the streak; 'unknown' is neutral (does not break and
 * does not increment).
 */
export function computeStreak(days: RoutineDay[], referenceDate: string): RoutineStreakSummary {
  const index = indexDays(days);
  const summary: RoutineStreakSummary = {
    currentStreak: 0,
    longestStreak: 0,
    completedDays: 0,
    skippedDays: 0,
    unknownDays: 0,
    referenceDate,
  };

  for (const day of days) {
    if (!day) continue;
    if (day.state === 'completed') summary.completedDays += 1;
    else if (day.state === 'skipped') summary.skippedDays += 1;
    else summary.unknownDays += 1;
  }

  // Current streak: walk backwards from reference date.
  let cursor = referenceDate;
  let guard = 0;
  while (guard < 100000) {
    guard += 1;
    const day = index.get(cursor);
    if (!day) break;
    if (day.state === 'completed') {
      summary.currentStreak += 1;
    } else if (day.state === 'skipped') {
      break;
    }
    // 'unknown' is neutral: continue walking backwards.
    cursor = addDays(cursor, -1);
  }

  // Longest streak: scan sorted unique dates.
  const sortedDates = Array.from(index.keys()).sort();
  let running = 0;
  let previousDate: string | null = null;
  for (const date of sortedDates) {
    const day = index.get(date)!;
    if (day.state === 'completed') {
      if (previousDate !== null && addDays(previousDate, 1) === date) {
        running += 1;
      } else {
        running = 1;
      }
      if (running > summary.longestStreak) summary.longestStreak = running;
    } else if (day.state === 'skipped') {
      running = 0;
    } else {
      // 'unknown' is neutral; keep running streak but do not increment.
    }
    previousDate = date;
  }

  return summary;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthBoundary(year: number, month: number): { firstDate: string; lastDate: string } {
  const last = daysInMonth(year, month);
  return {
    firstDate: toDateKey(year, month, 1),
    lastDate: toDateKey(year, month, last),
  };
}

/**
 * Builds a month grid (Sunday-first) padded to full weeks. Cells outside the
 * target month are marked with inMonth: false.
 */
export function buildMonthGrid(year: number, month: number): MonthGrid {
  const { firstDate, lastDate } = monthBoundary(year, month);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const total = daysInMonth(year, month);
  const cells: MonthGridCell[] = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    const date = addDays(firstDate, i - firstWeekday);
    const parsed = parseDateKey(date)!;
    cells.push({ date, dayOfMonth: parsed.day, inMonth: false });
  }

  for (let day = 1; day <= total; day += 1) {
    cells.push({ date: toDateKey(year, month, day), dayOfMonth: day, inMonth: true });
  }

  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const date = addDays(last, 1);
    const parsed = parseDateKey(date)!;
    cells.push({ date, dayOfMonth: parsed.day, inMonth: false });
  }

  return { year, month, cells, firstDate, lastDate };
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12 + 12) % 12 + 1;
  return { year: newYear, month: newMonth };
}

/**
 * Produces a distinct spoken label per day state so screen readers can
 * differentiate completed, skipped, and unknown days.
 */
export function formatDayAccessibilityLabel(day: RoutineDay, t: TranslateFn): string {
  const parsed = parseDateKey(day.date);
  const dateLabel = parsed
    ? t('routineStreak.dateLabel', {
        year: parsed.year,
        month: parsed.month,
        day: parsed.day,
      })
    : day.date;

  switch (day.state) {
    case 'completed':
      return t('routineStreak.a11y.completed', {
        date: dateLabel,
        count: day.eventCount,
      });
    case 'skipped':
      return t('routineStreak.a11y.skipped', {
        date: dateLabel,
        count: day.eventCount,
      });
    case 'unknown':
    default:
      return t('routineStreak.a11y.unknown', { date: dateLabel });
  }
}