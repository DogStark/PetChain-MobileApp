import {
  buildAccessibleChartTable,
  buildChartSummary,
  buildChartDataTable,
  buildClinicListSummary,
  buildMapSummary,
  describeTrend,
  formatTrendBadge,
  sectionHeading,
  type MapClinicLike,
  type SeriesPoint,
} from '../a11yChartSummary';

const weight: SeriesPoint[] = [
  { label: '2026-05-01', value: 10.2, unit: 'kg' },
  { label: '2026-06-01', value: 10.6, unit: 'kg' },
  { label: '2026-07-01', value: 11.1, unit: 'kg' },
];

describe('a11yChartSummary — charts (issues #979 & #1194)', () => {
  it('characterizes trend direction from the endpoints and formats non-color badges', () => {
    expect(describeTrend(weight)).toBe('rising');
    expect(describeTrend([...weight].reverse())).toBe('falling');
    expect(describeTrend([{ label: 'a', value: 5 }, { label: 'b', value: 5.05 }])).toBe('stable');
    expect(describeTrend([{ label: 'a', value: 5 }])).toBe('not enough data');

    expect(formatTrendBadge('rising')).toBe('↑ Rising');
    expect(formatTrendBadge('falling')).toBe('↓ Falling');
    expect(formatTrendBadge('stable')).toBe('→ Stable');
    expect(formatTrendBadge('not enough data')).toBe('— Not enough data');
  });

  it('builds a one-line summary with count, latest, trend and range', () => {
    const summary = buildChartSummary(weight, {
      metricName: 'Weight',
      rangeLabel: 'last 3 months',
    });
    expect(summary).toBe(
      'Weight chart over last 3 months. 3 readings. Latest 11.1 kg. Trend rising. Range 10.2 kg to 11.1 kg.',
    );
  });

  it('enforces server-confirmed permissions and blocks unauthorized access', () => {
    const deniedSummary = buildChartSummary(weight, {
      metricName: 'Weight',
      permissions: ['pets:read'],
    });
    expect(deniedSummary).toBe(
      'Permission denied. You do not have access to view health charts.',
    );
    expect(deniedSummary).not.toContain('11.1');

    const allowedSummary = buildChartSummary(weight, {
      metricName: 'Weight',
      permissions: ['pets:read', 'health:read'],
    });
    expect(allowedSummary).toContain('Latest 11.1 kg');

    expect(buildAccessibleChartTable(weight, { permissions: ['pets:read'] })).toEqual([]);
  });

  it('preserves offline and stale-data notices in chart summaries', () => {
    const offlineSummary = buildChartSummary(weight, {
      metricName: 'Weight',
      offline: true,
    });
    expect(offlineSummary).toContain('Showing cached readings; you are offline.');

    const staleOfflineEmpty = buildChartSummary([], {
      metricName: 'Heart rate',
      offline: true,
      stale: true,
    });
    expect(staleOfflineEmpty).toBe(
      'Heart rate chart. No data for the selected period. Showing cached readings; you are offline. Data may be stale.',
    );
  });

  it('detects mixed units and omits misleading cross-unit trend and range', () => {
    const mixed: SeriesPoint[] = [
      { label: '2026-05-01', value: 10.2, unit: 'kg' },
      { label: '2026-06-01', value: 23.0, unit: 'lb' },
    ];
    const summary = buildChartSummary(mixed, { metricName: 'Weight' });
    expect(summary).toBe(
      'Weight chart. 2 readings. Mixed units detected (kg, lb); trend and range omitted to avoid unit mismatch.',
    );
  });

  it('handles the empty / malformed-input path without throwing', () => {
    expect(buildChartSummary([], { metricName: 'Weight', rangeLabel: 'last year' })).toBe(
      'Weight chart. No data for last year.',
    );
    expect(
      buildChartSummary([{ label: 'bad', value: Number.NaN, unit: 'kg' }], {
        metricName: 'Weight',
      }),
    ).toBe('Weight chart. No data for the selected period.');
    expect(buildChartDataTable([])).toEqual([]);
    expect(buildAccessibleChartTable([])).toEqual([]);
  });

  it('produces a walkable point-by-point data table equivalent', () => {
    expect(buildChartDataTable(weight)).toEqual([
      'Point 1 of 3. 2026-05-01: 10.2 kg.',
      'Point 2 of 3. 2026-06-01: 10.6 kg.',
      'Point 3 of 3. 2026-07-01: 11.1 kg.',
    ]);
  });

  it('builds structured accessible table rows with dates, units, and non-color step trends', () => {
    const series: SeriesPoint[] = [
      { label: '2026-05-01', value: 10.2, unit: 'kg' },
      { label: '2026-06-01', value: 10.25, unit: 'kg' },
      { label: '2026-07-01', value: 11.0, unit: 'kg' },
      { label: '2026-08-01', value: 10.5, unit: 'kg' },
      { label: '2026-09-01', value: 23.1, unit: 'lb' },
    ];
    const rows = buildAccessibleChartTable(series, {
      stableEpsilon: 0.1,
      permissions: ['health:read'],
    });

    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      index: 1,
      total: 5,
      dateText: '2026-05-01',
      valueText: '10.2 kg',
      stepTrend: 'not enough data',
      stepTrendBadge: '— Not enough data',
      deltaText: 'Baseline reading',
    });
    expect(rows[1]).toMatchObject({
      stepTrend: 'stable',
      stepTrendBadge: '→ Stable',
      deltaText: 'No significant change (+0.05 kg)',
    });
    expect(rows[2]).toMatchObject({
      stepTrend: 'rising',
      stepTrendBadge: '↑ Rising',
      deltaText: '+0.75 kg',
    });
    expect(rows[3]).toMatchObject({
      stepTrend: 'falling',
      stepTrendBadge: '↓ Falling',
      deltaText: '-0.5 kg',
    });
    expect(rows[4]).toMatchObject({
      stepTrend: 'not enough data',
      stepTrendBadge: '— Not enough data',
      deltaText: 'Unit changed (kg to lb)',
    });
    expect(rows[2].spokenRow).toBe(
      'Row 3 of 5. Date: 2026-07-01. Value: 11 kg. Trend: rising (+0.75 kg).',
    );
  });

  it('does not leak precise values beyond 2 decimals or non-numeric noise', () => {
    const noisy: SeriesPoint[] = [{ label: 'x', value: 3.14159265, unit: 'bpm' }];
    expect(buildChartDataTable(noisy)[0]).toBe('Point 1 of 1. x: 3.14 bpm.');
  });
});

const clinics: MapClinicLike[] = [
  {
    name: 'Bayside Animal Hospital',
    type: 'emergency',
    address: '12 Harbor Rd',
    available24h: true,
    distance: 2.4,
    estimatedTravelMinutes: 7,
  },
  {
    name: 'Downtown Vet Clinic',
    type: 'general',
    address: '400 Main St',
    distance: 0.8,
    estimatedTravelMinutes: 3,
  },
];

describe('a11yChartSummary — map (issue #979)', () => {
  it('summarizes the visible pin set and names the nearest clinic', () => {
    expect(buildMapSummary(clinics, { filterLabel: 'All' })).toBe(
      'Vet map. 2 all locations nearby. Nearest: Downtown Vet Clinic, 0.8 kilometers away.',
    );
  });

  it('covers the offline path by noting cached results', () => {
    expect(buildMapSummary(clinics, { filterLabel: 'Emergency', offline: true })).toContain(
      'you are offline',
    );
  });

  it('covers the no-results path', () => {
    expect(buildMapSummary([], { filterLabel: 'Pharmacy' })).toBe(
      'Vet map. No pharmacy locations found nearby.',
    );
  });

  it('orders the list equivalent nearest-first and omits phone/coords', () => {
    const rows = buildClinicListSummary(clinics);
    expect(rows[0]).toBe(
      '1 of 2. Downtown Vet Clinic. general, 0.8 kilometers, about 3 minutes away. 400 Main St.',
    );
    expect(rows[1]).toContain('Bayside Animal Hospital');
    expect(rows[1]).toContain('open 24 hours');
    expect(rows.join(' ')).not.toMatch(/\d{3}-\d{4}/);
  });

  it('builds semantic heading text with an optional count', () => {
    expect(sectionHeading('Nearby vets')).toBe('Nearby vets');
    expect(sectionHeading('Nearby vets', 2)).toBe('Nearby vets (2)');
  });
});
