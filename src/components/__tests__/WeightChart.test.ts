import {
  buildDataPointAccessibilityLabel,
  buildWeightChartAccessibilityLabel,
  describeWeightTrend,
  rangeLabel,
} from '../weightChartAccessibility';

describe('WeightChart accessibility helpers', () => {
  const sampleData = [
    { date: '2026-01-01T00:00:00Z', weightKg: 10 },
    { date: '2026-02-01T00:00:00Z', weightKg: 11 },
    { date: '2026-03-01T00:00:00Z', weightKg: 12 },
  ];

  it('builds a chart summary label with pet name, weight, and trend', () => {
    expect(buildWeightChartAccessibilityLabel('Buddy', sampleData, '1M')).toBe(
      'Weight chart for Buddy. Current weight: 12.0 kg. Trend: increasing over the last 30 days.',
    );
  });

  it('describes stable and decreasing trends', () => {
    expect(describeWeightTrend(sampleData)).toBe('increasing');
    expect(
      describeWeightTrend([
        { date: '2026-01-01T00:00:00Z', weightKg: 12 },
        { date: '2026-02-01T00:00:00Z', weightKg: 11.5 },
      ]),
    ).toBe('decreasing');
    expect(
      describeWeightTrend([
        { date: '2026-01-01T00:00:00Z', weightKg: 12 },
        { date: '2026-02-01T00:00:00Z', weightKg: 12.05 },
      ]),
    ).toBe('stable');
  });

  it('labels individual data points for screen readers', () => {
    expect(
      buildDataPointAccessibilityLabel({
        date: '2026-03-01T00:00:00Z',
        weightKg: 12,
        note: 'Post-surgery',
      }),
    ).toContain('12.0 kilograms');
    expect(
      buildDataPointAccessibilityLabel({
        date: '2026-03-01T00:00:00Z',
        weightKg: 12,
        note: 'Post-surgery',
      }),
    ).toContain('Post-surgery');
  });

  it('maps range filters to readable periods', () => {
    expect(rangeLabel('3M')).toBe('the last 3 months');
    expect(rangeLabel('ALL')).toBe('all recorded data');
  });
});
