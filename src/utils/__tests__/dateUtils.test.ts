import {
  formatDate,
  toRelativeTime,
  isExpired,
  parseDate,
  isValidDate,
  getDateDifference,
  formatInTimezone,
} from '../dateUtils';

beforeAll(() => {
  jest.useFakeTimers();
  // Pin "now" to a known instant so relative tests are deterministic
  jest.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

describe('dateUtils', () => {
  // ─── formatDate ───────────────────────────────────────────────────────
  describe('formatDate', () => {
    it('formats a Date object to ISO string by default', () => {
      const date = new Date('2023-01-01T12:00:00Z');
      expect(formatDate(date)).toBe(date.toISOString());
    });

    it('formats a string date to ISO string by default', () => {
      const result = formatDate('2023-01-01T12:00:00Z');
      expect(result).toBe('2023-01-01T12:00:00.000Z');
    });

    it('formats with custom Intl options', () => {
      const date = new Date('2023-01-01T12:00:00Z');
      const formatted = formatDate(date, { year: 'numeric', month: 'long', day: 'numeric' });
      expect(formatted).toBe('January 1, 2023');
    });

    it('formats with a custom locale', () => {
      const date = new Date('2023-01-01T12:00:00Z');
      const formatted = formatDate(date, { year: 'numeric', month: 'long', day: 'numeric' }, 'es-ES');
      expect(formatted).toBe('1 de enero de 2023');
    });

    it('throws an error for an invalid date string', () => {
      expect(() => formatDate('not-a-date')).toThrow('Invalid date provided');
    });

    it('throws an error for an invalid Date object', () => {
      const invalid = new Date('invalid');
      expect(() => formatDate(invalid)).toThrow('Invalid date provided');
    });

    it('returns the same format for midnight UTC', () => {
      const date = new Date('2023-06-15T00:00:00.000Z');
      expect(formatDate(date)).toBe('2023-06-15T00:00:00.000Z');
    });

    it('handles string input with timezone offset', () => {
      const result = formatDate('2023-01-01T00:00:00+05:00');
      expect(result).toBe('2022-12-31T19:00:00.000Z');
    });
  });

  // ─── toRelativeTime ───────────────────────────────────────────────────
  describe('toRelativeTime', () => {
    it('returns "now" for very recent dates (< 1 second)', () => {
      const date = new Date(Date.now() - 500);
      const result = toRelativeTime(date);
      expect(['now', 'in 0 seconds', '0 seconds ago']).toContain(result);
    });

    it('returns seconds ago for a few seconds difference', () => {
      const date = new Date(Date.now() - 30_000);
      const result = toRelativeTime(date);
      expect(result).toBe('30 seconds ago');
    });

    it('returns minutes ago for recent past', () => {
      const date = new Date(Date.now() - 5 * 60_000);
      const result = toRelativeTime(date);
      expect(result).toBe('5 minutes ago');
    });

    it('returns "in X minutes" for future dates', () => {
      const date = new Date(Date.now() + 10 * 60_000);
      const result = toRelativeTime(date);
      expect(result).toBe('in 10 minutes');
    });

    it('returns hours ago for past hours', () => {
      const date = new Date(Date.now() - 3 * 3_600_000);
      const result = toRelativeTime(date);
      expect(result).toBe('3 hours ago');
    });

    it('returns "in X hours" for future hours', () => {
      const date = new Date(Date.now() + 6 * 3_600_000);
      const result = toRelativeTime(date);
      expect(result).toBe('in 6 hours');
    });

    it('returns days ago for past days', () => {
      const date = new Date(Date.now() - 2 * 86_400_000);
      const result = toRelativeTime(date);
      expect(result).toBe('2 days ago');
    });

    it('returns "tomorrow" for 1 day in the future', () => {
      const date = new Date(Date.now() + 1 * 86_400_000);
      const result = toRelativeTime(date);
      expect(result).toBe('tomorrow');
    });

    it('returns months ago for past months', () => {
      const date = new Date(Date.now() - 60 * 86_400_000);
      const result = toRelativeTime(date);
      expect(result).toBe('2 months ago');
    });

    it('returns years ago for past years', () => {
      const date = new Date(Date.now() - 730 * 86_400_000);
      const result = toRelativeTime(date);
      expect(result).toBe('2 years ago');
    });

    it('respects a custom locale', () => {
      const date = new Date(Date.now() - 2 * 86_400_000);
      const result = toRelativeTime(date, 'es-ES');
      expect(result).toBe('hace 2 días');
    });

    it('throws for an invalid date', () => {
      expect(() => toRelativeTime('bad-date')).toThrow('Invalid date provided');
    });
  });

  // ─── isExpired ────────────────────────────────────────────────────────
  describe('isExpired', () => {
    it('returns true for a date in the past', () => {
      const past = new Date('2020-01-01');
      expect(isExpired(past)).toBe(true);
    });

    it('returns false for a date in the future', () => {
      const future = new Date('2030-01-01');
      expect(isExpired(future)).toBe(false);
    });

    it('returns true for a date that is exactly now (boundary)', () => {
      const now = new Date(Date.now());
      expect(isExpired(now)).toBe(true);
    });

    it('returns true for a date string in the past', () => {
      expect(isExpired('2020-06-15T00:00:00.000Z')).toBe(true);
    });

    it('returns false for a date string in the future', () => {
      expect(isExpired('2030-06-15T00:00:00.000Z')).toBe(false);
    });

    it('throws for an invalid date string', () => {
      expect(() => isExpired('not-a-date')).toThrow('Invalid date provided');
    });

    it('throws for an invalid Date object', () => {
      expect(() => isExpired(new Date('nope'))).toThrow('Invalid date provided');
    });
  });

  // ─── parseDate ────────────────────────────────────────────────────────
  describe('parseDate', () => {
    it('parses a valid ISO string into a Date', () => {
      const result = parseDate('2023-01-01T00:00:00.000Z');
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe('2023-01-01T00:00:00.000Z');
    });

    it('returns null for an invalid string', () => {
      expect(parseDate('invalid')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(parseDate('')).toBeNull();
    });
  });

  // ─── isValidDate ──────────────────────────────────────────────────────
  describe('isValidDate', () => {
    it('returns true for a valid Date object', () => {
      expect(isValidDate(new Date())).toBe(true);
    });

    it('returns true for a valid date string', () => {
      expect(isValidDate('2023-01-01')).toBe(true);
    });

    it('returns false for null', () => {
      expect(isValidDate(null)).toBe(false);
    });

    it('returns false for an invalid string', () => {
      expect(isValidDate('not-a-date')).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isValidDate(undefined)).toBe(false);
    });
  });

  // ─── getDateDifference ────────────────────────────────────────────────
  describe('getDateDifference', () => {
    it('calculates difference in days', () => {
      const start = '2023-01-01';
      const end = '2023-01-10';
      expect(getDateDifference(start, end, 'days')).toBe(9);
    });

    it('calculates difference in hours', () => {
      const start = '2023-01-01T10:00:00Z';
      const end = '2023-01-01T14:30:00Z';
      expect(getDateDifference(start, end, 'hours')).toBe(4);
    });

    it('calculates difference in minutes', () => {
      const start = '2023-01-01T10:00:00Z';
      const end = '2023-01-01T10:45:00Z';
      expect(getDateDifference(start, end, 'minutes')).toBe(45);
    });

    it('calculates difference in seconds', () => {
      const start = '2023-01-01T10:00:00Z';
      const end = '2023-01-01T10:00:30Z';
      expect(getDateDifference(start, end, 'seconds')).toBe(30);
    });

    it('returns a negative value when end is before start', () => {
      const start = '2023-01-10';
      const end = '2023-01-01';
      expect(getDateDifference(start, end, 'days')).toBe(-9);
    });

    it('throws for invalid start date', () => {
      expect(() => getDateDifference('bad', '2023-01-01')).toThrow('Invalid date provided');
    });
  });

  // ─── Timezone handling ────────────────────────────────────────────────
  describe('formatInTimezone', () => {
    it('formats a date in a specific timezone', () => {
      const date = new Date('2026-06-01T17:00:00.000Z');
      const result = formatInTimezone(date, 'America/New_York');
      expect(result).toContain('06/01/2026');
      expect(result).toContain('01');
    });

    it('formats a date in a different timezone showing the date shift', () => {
      const date = new Date('2026-06-01T02:00:00.000Z');
      const result = formatInTimezone(date, 'America/New_York', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      expect(result).toBe('05/31/2026');
    });

    it('formats with custom options', () => {
      const date = new Date('2026-06-01T12:00:00.000Z');
      const result = formatInTimezone(date, 'Europe/London', {
        hour: '2-digit',
        minute: '2-digit',
      });
      expect(result).toContain('13');
    });

    it('handles Asia/Tokyo timezone', () => {
      const date = new Date('2026-06-01T00:00:00.000Z');
      const result = formatInTimezone(date, 'Asia/Tokyo', { year: 'numeric', month: '2-digit', day: '2-digit' });
      expect(result).toBe('06/01/2026');
    });

    it('throws for invalid date', () => {
      expect(() => formatInTimezone('bad', 'UTC')).toThrow('Invalid date provided');
    });
  });
});
