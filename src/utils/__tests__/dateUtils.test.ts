import {
  formatDate,
  toRelativeTime,
  isExpired,
  addDays,
  addWeeks,
  addMinutes,
  startOfDay,
  endOfDay,
  isSameDay,
  differenceInDays,
} from '../dateUtils';

// ─── formatDate ───────────────────────────────────────────────────────────────

describe('formatDate', () => {
  const DATE = '2025-06-15T12:00:00.000Z';

  it('returns ISO string by default', () => {
    expect(formatDate(DATE)).toBe(new Date(DATE).toISOString());
  });

  it('returns ISO string when format="iso"', () => {
    expect(formatDate(DATE, 'iso')).toBe(new Date(DATE).toISOString());
  });

  it('formats with "short" preset', () => {
    const result = formatDate(DATE, 'short', 'en-US');
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/2025/);
  });

  it('formats with "long" preset', () => {
    const result = formatDate(DATE, 'long', 'en-US');
    expect(result).toMatch(/June/);
    expect(result).toMatch(/2025/);
  });

  it('formats with "time" preset', () => {
    const result = formatDate(DATE, 'time', 'en-US');
    // time string contains colon
    expect(result).toMatch(/:/);
  });

  it('formats with "datetime" preset', () => {
    const result = formatDate(DATE, 'datetime', 'en-US');
    expect(result).toMatch(/2025/);
    expect(result).toMatch(/:/);
  });

  it('accepts a custom Intl.DateTimeFormatOptions object', () => {
    const result = formatDate(DATE, { weekday: 'long' }, 'en-US');
    // 2025-06-15 is a Sunday
    expect(result).toBe('Sunday');
  });

  it('accepts a Date object', () => {
    const d = new Date('2025-01-01T00:00:00.000Z');
    expect(formatDate(d, 'iso')).toBe(d.toISOString());
  });

  it('throws for an invalid date string', () => {
    expect(() => formatDate('not-a-date')).toThrow();
  });
});

// ─── toRelativeTime ───────────────────────────────────────────────────────────

describe('toRelativeTime', () => {
  it('returns a string for a past date', () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1_000); // 2 hours ago
    const result = toRelativeTime(past, 'en-US');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a string for a future date', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1_000); // 1 day from now
    const result = toRelativeTime(future, 'en-US');
    expect(typeof result).toBe('string');
  });

  it.each([
    [30_000, 'second'], // 30 seconds
    [2 * 60_000, 'minute'], // 2 minutes
    [3 * 3_600_000, 'hour'], // 3 hours
    [2 * 86_400_000, 'day'], // 2 days
    [45 * 86_400_000, 'month'], // ~1.5 months
    [2 * 31_536_000_000, 'year'], // 2 years
  ])('uses correct unit for %dms offset', (offsetMs, expectedUnit) => {
    const past = new Date(Date.now() - offsetMs);
    const result = toRelativeTime(past, 'en-US');
    expect(result).toMatch(new RegExp(expectedUnit, 'i'));
  });
});

// ─── isExpired ────────────────────────────────────────────────────────────────

describe('isExpired', () => {
  it('returns true for a past date', () => {
    expect(isExpired('2020-01-01')).toBe(true);
  });

  it('returns false for a future date', () => {
    expect(isExpired('2099-12-31')).toBe(false);
  });

  it('accepts a Date object', () => {
    expect(isExpired(new Date(Date.now() - 1_000))).toBe(true);
  });
});

// ─── addDays ──────────────────────────────────────────────────────────────────

describe('addDays', () => {
  it.each([
    ['2025-01-01', 7, '2025-01-08'],
    ['2025-01-08', -3, '2025-01-05'],
    ['2024-02-28', 1, '2024-02-29'], // leap year
    ['2025-12-31', 1, '2026-01-01'],
  ])('addDays(%s, %d) date portion equals %s', (input, days, expected) => {
    const result = addDays(input, days);
    const iso = result.toISOString().slice(0, 10);
    expect(iso).toBe(expected);
  });

  it('returns a new Date without mutating input', () => {
    const original = new Date('2025-01-01T00:00:00.000Z');
    const result = addDays(original, 5);
    expect(original.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(result).not.toBe(original);
  });
});

// ─── addWeeks ─────────────────────────────────────────────────────────────────

describe('addWeeks', () => {
  it.each([
    ['2025-01-01', 1, '2025-01-08'],
    ['2025-01-01', 2, '2025-01-15'],
    ['2025-01-01', -1, '2024-12-25'],
  ])('addWeeks(%s, %d) date portion equals %s', (input, weeks, expected) => {
    const iso = addWeeks(input, weeks).toISOString().slice(0, 10);
    expect(iso).toBe(expected);
  });
});

// ─── addMinutes ───────────────────────────────────────────────────────────────

describe('addMinutes', () => {
  it('adds positive minutes', () => {
    const base = new Date('2025-01-01T12:00:00.000Z');
    const result = addMinutes(base, 30);
    expect(result.toISOString()).toBe('2025-01-01T12:30:00.000Z');
  });

  it('subtracts minutes when negative', () => {
    const base = new Date('2025-01-01T12:00:00.000Z');
    const result = addMinutes(base, -15);
    expect(result.toISOString()).toBe('2025-01-01T11:45:00.000Z');
  });
});

// ─── startOfDay / endOfDay ────────────────────────────────────────────────────

describe('startOfDay', () => {
  it('sets time to midnight', () => {
    const d = new Date('2025-06-15T14:30:45.123');
    const result = startOfDay(d);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
    expect(result.getDate()).toBe(15);
  });
});

describe('endOfDay', () => {
  it('sets time to 23:59:59.999', () => {
    const d = new Date('2025-06-15T00:00:00');
    const result = endOfDay(d);
    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(59);
    expect(result.getSeconds()).toBe(59);
    expect(result.getMilliseconds()).toBe(999);
  });
});

// ─── isSameDay ────────────────────────────────────────────────────────────────

describe('isSameDay', () => {
  it('returns true for two dates on the same local day', () => {
    const a = new Date(2025, 5, 15, 0, 0, 0);
    const b = new Date(2025, 5, 15, 23, 59, 59);
    expect(isSameDay(a, b)).toBe(true);
  });

  it('returns false for dates on different days', () => {
    expect(isSameDay('2025-01-01', '2025-01-02')).toBe(false);
  });
});

// ─── differenceInDays ─────────────────────────────────────────────────────────

describe('differenceInDays', () => {
  it.each([
    ['2025-01-01', '2025-01-08', 7],
    ['2025-01-08', '2025-01-01', -7],
    ['2025-01-01', '2025-01-01', 0],
  ])('differenceInDays(%s, %s) = %d', (start, end, expected) => {
    expect(differenceInDays(start, end)).toBe(expected);
  });
});
