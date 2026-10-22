/**
 * Safe date parsing helper.
 * Throws if the input is not a valid date.
 */
function toDate(date: Date | string): Date {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(parsed.getTime())) {
    throw new Error('Invalid date provided');
  }
  return parsed;
}

/**
 * Format a date to ISO string by default, or with custom Intl format options.
 */
export function formatDate(
  date: Date | string,
  format?: Intl.DateTimeFormatOptions,
  locale = 'en-US',
): string {
  const parsed = toDate(date);
  if (!format) {
    return parsed.toISOString();
  }
  return new Intl.DateTimeFormat(locale, format).format(parsed);
}

/**
 * Parse a date string safely, returning null for invalid input.
 */
export function parseDate(dateString: string): Date | null {
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Check whether a value is a valid date.
 */
export function isValidDate(date: unknown): boolean {
  if (!date) return false;
  const parsed = typeof date === 'string' ? new Date(date) : (date as Date);
  return parsed instanceof Date && !isNaN(parsed.getTime());
}

/**
 * Get a human-friendly relative time string, e.g. "2 days ago", "in 1 hour".
 */
export function toRelativeTime(date: Date | string, locale = 'en-US'): string {
  const parsed = toDate(date);
  const diffMs = parsed.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const abs = Math.abs(diffMs);
  if (abs < 60_000) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  if (abs < 2_592_000_000) return rtf.format(Math.round(diffMs / 86_400_000), 'day');
  if (abs < 31_536_000_000) return rtf.format(Math.round(diffMs / 2_592_000_000), 'month');
  return rtf.format(Math.round(diffMs / 31_536_000_000), 'year');
}

/**
 * Check if a date (or date string) is in the past.
 */
export function isExpired(date: Date | string): boolean {
  const parsed = toDate(date);
  return parsed.getTime() <= Date.now();
}

/**
 * Calculate the difference between two dates in the given unit.
 */
export function getDateDifference(
  start: Date | string,
  end: Date | string,
  unit: 'days' | 'hours' | 'minutes' | 'seconds' = 'days',
): number {
  const startDate = toDate(start);
  const endDate = toDate(end);
  const diffMs = endDate.getTime() - startDate.getTime();

  switch (unit) {
    case 'days':
      return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    case 'hours':
      return Math.floor(diffMs / (1000 * 60 * 60));
    case 'minutes':
      return Math.floor(diffMs / (1000 * 60));
    case 'seconds':
      return Math.floor(diffMs / 1000);
    default:
      throw new Error('Unsupported unit');
  }
}

/**
 * Format a date in a specific IANA timezone.
 */
export function formatInTimezone(
  date: Date | string,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions,
  locale = 'en-US',
): string {
  const parsed = toDate(date);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    ...(options || {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  }).format(parsed);
}
