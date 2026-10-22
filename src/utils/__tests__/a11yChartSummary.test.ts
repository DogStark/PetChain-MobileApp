import {
  buildChartSummary,
  buildChartDataTable,
  buildClinicListSummary,
  buildMapSummary,
  describeTrend,
  sectionHeading,
  type MapClinicLike,
  type SeriesPoint,
} from '../a11yChartSummary';

const weight: SeriesPoint[] = [
  { label: '2026-05-01', value: 10.2, unit: 'kg' },
  { label: '2026-06-01', value: 10.6, unit: 'kg' },
  { label: '2026-07-01', value: 11.1, unit: 'kg' },
];

describe('a11yChartSummary — charts (issue #979)', () => {
  it('characterizes trend direction from the endpoints', () => {
    expect(describeTrend(weight)).toBe('rising');
    expect(describeTrend([...weight].reverse())).toBe('falling');
    expect(describeTrend([{ label: 'a', value: 5 }, { label: 'b', value: 5.05 }])).toBe('stable');
    expect(describeTrend([{ label: 'a', value: 5 }])).toBe('not enough data');
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

  it('handles the empty / malformed-input path without throwing', () => {
    expect(buildChartSummary([], { metricName: 'Weight', rangeLabel: 'last year' })).toBe(
      'Weight chart. No data for last year.',
    );
    expect(buildChartDataTable([])).toEqual([]);
  });

  it('produces a walkable point-by-point data table equivalent', () => {
    expect(buildChartDataTable(weight)).toEqual([
      'Point 1 of 3. 2026-05-01: 10.2 kg.',
      'Point 2 of 3. 2026-06-01: 10.6 kg.',
      'Point 3 of 3. 2026-07-01: 11.1 kg.',
    ]);
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
