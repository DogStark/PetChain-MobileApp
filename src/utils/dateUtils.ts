/**
 * Pure date and time utility functions for PetChain Mobile App.
 *
 * All functions are side-effect-free and suitable for use in both
 * React Native components and background workers.
 *
 * No external dependencies — relies on the built-in Intl API (available in
 * JavaScriptCore / Hermes on iOS and Android) and the standard Date object.
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Coerce a `Date | string` to a `Date`.
 * Throws with a descriptive message if the value is not a valid date.
 */
function toDate(date: Date | string): Date {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: "${date}"`);
  }
  return parsed;
}

// ─── formatDate ───────────────────────────────────────────────────────────────

/**
 * Format a date using a named format or custom `Intl.DateTimeFormatOptions`.
 *
 * Named formats:
 * - `'short'`    → "Jan 5, 2025"
 * - `'long'`     → "January 5, 2025"
 * - `'time'`     → "2:30 PM"
 * - `'datetime'` → "Jan 5, 2025, 2:30 PM"
 * - `'iso'`      → ISO 8601 string (default)
 *
 * @example
 * formatDate('2025-01-05', 'short')         // "Jan 5, 2025"
 * formatDate(new Date(), 'datetime')        // "Jan 5, 2025, 2:30 PM"
 * formatDate('2025-01-05', { weekday: 'long' }) // "Sunday"
 */
export function formatDate(
  date: Date | string,
  format: 'iso' | 'short' | 'long' | 'time' | 'datetime' | Intl.DateTimeFormatOptions = 'iso',
  locale = 'en-US',
): string {
  const parsed = toDate(date);

  if (format === 'iso') {
    return parsed.toISOString();
  }

  const PRESETS: Record<string, Intl.DateTimeFormatOptions> = {
    short: { year: 'numeric', month: 'short', day: 'numeric' },
    long: { year: 'numeric', month: 'long', day: 'numeric' },
    time: { hour: '2-digit', minute: '2-digit' },
    datetime: {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
  };

  const options: Intl.DateTimeFormatOptions = typeof format === 'string' ? PRESETS[format] : format;

  return new Intl.DateTimeFormat(locale, options).format(parsed);
}

// ─── toRelativeTime ───────────────────────────────────────────────────────────

/**
 * Return a human-readable relative time string (e.g. "2 hours ago", "in 3 days").
 *
 * Uses `Intl.RelativeTimeFormat` so the output is automatically localised.
 *
 * @example
 * toRelativeTime(new Date(Date.now() - 90_000))  // "2 minutes ago"
 * toRelativeTime(new Date(Date.now() + 86_400_000)) // "in 1 day"
 */
export function toRelativeTime(date: Date | string, locale = 'en-US'): string {
  const parsed = toDate(date);
  const diffMs = parsed.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const abs = Math.abs(diffMs);

  if (abs < 60_000) return rtf.format(Math.round(diffMs / 1_000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  if (abs < 2_592_000_000) return rtf.format(Math.round(diffMs / 86_400_000), 'day');
  if (abs < 31_536_000_000) return rtf.format(Math.round(diffMs / 2_592_000_000), 'month');
  return rtf.format(Math.round(diffMs / 31_536_000_000), 'year');
}

// ─── isExpired ────────────────────────────────────────────────────────────────

/**
 * Return `true` when the given date is strictly in the past (before `Date.now()`).
 *
 * Useful for checking whether a medication end date, subscription, or token has expired.
 *
 * @example
 * isExpired('2020-01-01')  // true
 * isExpired('2099-12-31')  // false
 */
export function isExpired(date: Date | string): boolean {
  return toDate(date).getTime() < Date.now();
}

// ─── addDays ──────────────────────────────────────────────────────────────────

/**
 * Return a new `Date` that is `n` days after (positive) or before (negative) `date`.
 *
 * The time component is preserved.
 *
 * @example
 * addDays(new Date('2025-01-01'), 7)  // 2025-01-08T…
 * addDays(new Date('2025-01-08'), -3) // 2025-01-05T…
 */
export function addDays(date: Date | string, days: number): Date {
  const parsed = toDate(date);
  return new Date(parsed.getTime() + days * 24 * 60 * 60 * 1_000);
}

// ─── addWeeks ─────────────────────────────────────────────────────────────────

/**
 * Return a new `Date` that is `n` weeks after (positive) or before (negative) `date`.
 *
 * @example
 * addWeeks(new Date('2025-01-01'), 2)  // 2025-01-15T…
 */
export function addWeeks(date: Date | string, weeks: number): Date {
  return addDays(date, weeks * 7);
}

// ─── addMinutes ───────────────────────────────────────────────────────────────

/**
 * Return a new `Date` that is `n` minutes after (positive) or before (negative) `date`.
 *
 * @example
 * addMinutes(new Date('2025-01-01T12:00:00'), 30)  // 2025-01-01T12:30:00
 */
export function addMinutes(date: Date | string, minutes: number): Date {
  const parsed = toDate(date);
  return new Date(parsed.getTime() + minutes * 60 * 1_000);
}

// ─── startOfDay / endOfDay ────────────────────────────────────────────────────

/**
 * Return a new `Date` at midnight (00:00:00.000) on the same local calendar day.
 */
export function startOfDay(date: Date | string): Date {
  const d = toDate(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Return a new `Date` at 23:59:59.999 on the same local calendar day.
 */
export function endOfDay(date: Date | string): Date {
  const d = toDate(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

// ─── isSameDay ────────────────────────────────────────────────────────────────

/**
 * Return `true` when both dates fall on the same local calendar day.
 *
 * @example
 * isSameDay('2025-01-01T00:00:00', '2025-01-01T23:59:59')  // true
 * isSameDay('2025-01-01', '2025-01-02')                    // false
 */
export function isSameDay(a: Date | string, b: Date | string): boolean {
  const da = toDate(a);
  const db = toDate(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// ─── differenceInDays ─────────────────────────────────────────────────────────

/**
 * Return the integer number of whole days between `start` and `end`.
 * Result is positive when `end` is after `start`.
 *
 * @example
 * differenceInDays('2025-01-01', '2025-01-08')  // 7
 * differenceInDays('2025-01-08', '2025-01-01')  // -7
 */
export function differenceInDays(start: Date | string, end: Date | string): number {
  const startMs = toDate(start).getTime();
  const endMs = toDate(end).getTime();
  return Math.trunc((endMs - startMs) / (24 * 60 * 60 * 1_000));
}
