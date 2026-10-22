import { getRetentionCutoffDate, checkRetention, redactPHI } from '../complianceService';

describe('getRetentionCutoffDate', () => {
  it('returns a date 7 years in the past by default', () => {
    const cutoff = new Date(getRetentionCutoffDate());
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);
    expect(Math.abs(cutoff.getTime() - sevenYearsAgo.getTime())).toBeLessThan(5000);
  });

  it('respects custom retention period', () => {
    const cutoff = new Date(getRetentionCutoffDate(3));
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    expect(Math.abs(cutoff.getTime() - threeYearsAgo.getTime())).toBeLessThan(5000);
  });
});

describe('checkRetention', () => {
  it('flags old records for archiving', () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 8);
    const results = checkRetention([{ id: '1', createdAt: oldDate.toISOString() }]);
    expect(results[0].shouldArchive).toBe(true);
    expect(results[0].daysUntilArchive).toBe(0);
  });

  it('does not flag recent records', () => {
    const recentDate = new Date();
    recentDate.setFullYear(recentDate.getFullYear() - 1);
    const results = checkRetention([{ id: '2', createdAt: recentDate.toISOString() }]);
    expect(results[0].shouldArchive).toBe(false);
    expect(results[0].daysUntilArchive).toBeGreaterThan(0);
  });
});

describe('redactPHI', () => {
  it('redacts known PHI fields', () => {
    const record = {
      id: 'rec-1',
      name: 'John Doe',
      email: 'john@example.com',
      diagnosis: 'Condition X',
      weight: 70,
    };
    const redacted = redactPHI(record);
    expect(redacted.name).toBe('[REDACTED]');
    expect(redacted.email).toBe('[REDACTED]');
    expect(redacted.diagnosis).toBe('[REDACTED]');
    // Non-PHI fields remain
    expect(redacted.id).toBe('rec-1');
    expect(redacted.weight).toBe(70);
  });

  it('leaves records without PHI fields unchanged', () => {
    const record = { id: 'x', value: 42 };
    const redacted = redactPHI(record);
    expect(redacted).toEqual(record);
  });
});
