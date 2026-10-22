// backend/utils/dateUtils.ts

/**
 * Safely converts input into a Date object.
 * Throws if invalid.
 */
function toDate(date: Date | string): Date {
  const parsed = typeof date === 'string' ? new Date(date) : date;

  if (isNaN(parsed.getTime())) {
    throw new Error('Invalid date provided');
  }

  return parsed;
}

/**
 * Format date to ISO or custom format.
 * Default: ISO string.
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
 * Parse a date safely.
 * Returns null instead of throwing.
 */
export function parseDate(dateString: string): Date | null {
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Validate if input is a valid date.
 */
export function isValidDate(date: unknown): boolean {
  if (!date) return false;

  const parsed = typeof date === 'string' ? new Date(date) : (date as Date);

  return parsed instanceof Date && !isNaN(parsed.getTime());
}

/**
 * Get difference between two dates.
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
 * Get relative time string (e.g., "2 days ago" / "hace 2 días")
 */
export function getRelativeTime(date: Date | string, locale = 'en-US'): string {
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
 * Convert date to a specific timezone using Intl API.
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

function formatTimeZoneParts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  return parts.reduce(
    (result, part) => {
      if (part.type !== 'literal') {
        result[part.type] = part.value;
      }
      return result;
    },
    {} as Record<string, string>,
  );
}

function compareParts(a: Record<string, string>, b: Record<string, string>): number {
  const keys = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;
  for (const key of keys) {
    const diff = Number(a[key]) - Number(b[key]);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function parseZonedDateTime(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  if ([year, month, day, hour, minute].some((value) => Number.isNaN(value))) {
    throw new Error('Invalid date or time format');
  }

  const target = {
    year: year.toString().padStart(4, '0'),
    month: month.toString().padStart(2, '0'),
    day: day.toString().padStart(2, '0'),
    hour: hour.toString().padStart(2, '0'),
    minute: minute.toString().padStart(2, '0'),
    second: '00',
  };

  const lower = new Date(Date.UTC(year - 1, 0, 1));
  const upper = new Date(Date.UTC(year + 1, 11, 31, 23, 59, 59, 999));
  let low = lower.getTime();
  let high = upper.getTime();

  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const midDate = new Date(mid);
    const formatted = formatTimeZoneParts(midDate, timeZone);
    const comparison = compareParts(formatted, target);

    if (comparison <= 0) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return new Date(high);
}

export function addMinutes(date: Date | string, minutes: number): Date {
  const parsed = toDate(date);
  return new Date(parsed.getTime() + minutes * 60 * 1000);
}

export function getCurrentDateInTimezone(timeZone: string): string {
  return formatInTimezone(
    new Date(),
    timeZone,
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
    'en-CA',
  );
}
