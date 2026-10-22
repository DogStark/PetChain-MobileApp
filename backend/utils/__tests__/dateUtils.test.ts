import {
  formatDate,
  formatInTimezone,
  getCurrentDateInTimezone,
  getDateDifference,
  getRelativeTime,
  isValidDate,
  parseDate,
  parseZonedDateTime,
} from '../dateUtils';

describe('dateUtils', () => {
  describe('formatDate', () => {
    it('should format date to ISO string by default', () => {
      const date = new Date('2023-01-01T12:00:00Z');
      expect(formatDate(date)).toBe(date.toISOString());
    });

    it('should format date with options', () => {
      const date = new Date('2023-01-01T12:00:00Z');
      const formatted = formatDate(date, { year: 'numeric' });
      expect(formatted).toContain('2023');
    });

    it('should throw error for invalid date', () => {
      expect(() => formatDate('invalid')).toThrow('Invalid date provided');
    });
  });

  describe('parseDate', () => {
    it('should parse valid date string', () => {
      const date = parseDate('2023-01-01');
      expect(date).toBeInstanceOf(Date);
      expect(date?.getFullYear()).toBe(2023);
    });

    it('should return null for invalid date string', () => {
      expect(parseDate('invalid')).toBeNull();
    });
  });

  describe('isValidDate', () => {
    it('should return true for valid date', () => {
      expect(isValidDate(new Date())).toBe(true);
      expect(isValidDate('2023-01-01')).toBe(true);
    });

    it('should return false for invalid date', () => {
      expect(isValidDate(null)).toBe(false);
      expect(isValidDate('invalid')).toBe(false);
    });
  });

  describe('getDateDifference', () => {
    it('should calculate difference in days', () => {
      const start = '2023-01-01';
      const end = '2023-01-03';
      expect(getDateDifference(start, end, 'days')).toBe(2);
    });

    it('should calculate difference in hours', () => {
      const start = '2023-01-01T10:00:00Z';
      const end = '2023-01-01T12:00:00Z';
      expect(getDateDifference(start, end, 'hours')).toBe(2);
    });
  });

  describe('getRelativeTime', () => {
    it('should return relative time for past', () => {
      const past = new Date();
      past.setDate(past.getDate() - 2);
      expect(getRelativeTime(past)).toBe('2 days ago');
    });

    it('should return relative time for future', () => {
      const future = new Date();
      future.setDate(future.getDate() + 1);
      const result = getRelativeTime(future);
      expect(['in 1 day', 'tomorrow']).toContain(result);
    });

    it('should return "just now" for very recent', () => {
      const result = getRelativeTime(new Date());
      expect(['just now', 'now']).toContain(result);
    });
  });

  describe('timezone helpers', () => {
    it('should parse a local timezone datetime into a valid UTC instant', () => {
      const parsed = parseZonedDateTime('2026-06-01', '10:00', 'America/Los_Angeles');
      expect(parsed.toISOString()).toMatch(/^2026-06-01T/);
      expect(formatInTimezone(parsed, 'America/Los_Angeles')).toContain('06/01/2026');
      expect(formatInTimezone(parsed, 'America/Los_Angeles')).toContain('10:00');
    });

    it('should return current date in a requested timezone', () => {
      const dateString = getCurrentDateInTimezone('America/Chicago');
      expect(dateString).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });
});
