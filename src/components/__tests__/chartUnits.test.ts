import {
  IncompatibleSeriesError,
  KG_PER_LB,
  assertHomogeneousBiomarker,
  describeProvenance,
  normalizeWeightSeries,
  seriesHasMixedUnits,
  toKilograms,
} from '../chartUnits';

describe('chartUnits — weight normalization (issue #968)', () => {
  it('characterizes the bug: a raw mixed kg/lb series is not comparable until normalized', () => {
    const raw = [
      { date: '2026-01-01', weight: 10, unit: 'kg' as const },
      { date: '2026-02-01', weight: 22, unit: 'lb' as const },
    ];
    expect(seriesHasMixedUnits(raw)).toBe(true);

    const normalized = normalizeWeightSeries(raw);
    expect(normalized.map((p) => p.weightKg)).toEqual([10, Number((22 * KG_PER_LB).toFixed(4))]);
    expect(normalized[1].sourceUnit).toBe('lb');
  });

  it('treats a missing unit as kg', () => {
    const [p] = normalizeWeightSeries([{ date: '2026-01-01', weight: 7.5 }]);
    expect(p).toMatchObject({ weightKg: 7.5, sourceUnit: 'kg' });
  });

  it('toKilograms converts pounds and rejects malformed input', () => {
    expect(toKilograms(1, 'lb')).toBeCloseTo(0.4535924, 6);
    expect(toKilograms(3, 'kg')).toBe(3);
    expect(() => toKilograms(Number.NaN, 'kg')).toThrow(RangeError);
  });

  it('describeProvenance labels non-kg / sourced points and stays quiet otherwise', () => {
    expect(
      describeProvenance({ date: 'd', weightKg: 1, sourceUnit: 'lb', source: 'owner-entry' }),
    ).toBe('(entered in lb, owner-entry)');
    expect(describeProvenance({ date: 'd', weightKg: 1, sourceUnit: 'kg' })).toBe('');
  });
});

describe('chartUnits — biomarker compatibility (issue #968)', () => {
  it('accepts a homogeneous series and returns its shared biomarker/unit', () => {
    expect(
      assertHomogeneousBiomarker([
        { date: 'a', value: 80, biomarker: 'health-score' },
        { date: 'b', value: 82, biomarker: 'health-score' },
      ]),
    ).toEqual({ biomarker: 'health-score', unit: undefined });
  });

  it('throws when different biomarkers are mixed into one series', () => {
    expect(() =>
      assertHomogeneousBiomarker([
        { date: 'a', value: 80, biomarker: 'health-score' },
        { date: 'b', value: 5.4, biomarker: 'glucose' },
      ]),
    ).toThrow(IncompatibleSeriesError);
  });

  it('throws when different units are mixed into one series', () => {
    expect(() =>
      assertHomogeneousBiomarker([
        { date: 'a', value: 10, unit: 'kg' },
        { date: 'b', value: 22, unit: 'lb' },
      ]),
    ).toThrow(/different units/);
  });
});
