export type DateRangeFilter = '1M' | '3M' | '1Y' | 'ALL';

export interface WeightDataPoint {
  date: string;
  weightKg: number;
  note?: string;
}

export function rangeLabel(range: DateRangeFilter): string {
  switch (range) {
    case '1M':
      return 'the last 30 days';
    case '3M':
      return 'the last 3 months';
    case '1Y':
      return 'the last year';
    default:
      return 'all recorded data';
  }
}

export function formatDateLabel(iso: string, compact = false): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  if (compact) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function filterDataByRange(
  data: WeightDataPoint[],
  range: DateRangeFilter,
): WeightDataPoint[] {
  if (range === 'ALL') return data;

  const now = new Date();
  const cutoff = new Date(now);

  switch (range) {
    case '1M':
      cutoff.setMonth(now.getMonth() - 1);
      break;
    case '3M':
      cutoff.setMonth(now.getMonth() - 3);
      break;
    case '1Y':
      cutoff.setFullYear(now.getFullYear() - 1);
      break;
  }

  return data.filter((d) => new Date(d.date) >= cutoff);
}

export function describeWeightTrend(data: WeightDataPoint[]): string {
  if (data.length < 2) return 'insufficient data for trend';
  const sorted = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const delta = sorted[sorted.length - 1].weightKg - sorted[0].weightKg;
  if (Math.abs(delta) < 0.1) return 'stable';
  return delta > 0 ? 'increasing' : 'decreasing';
}

export function buildWeightChartAccessibilityLabel(
  petName: string | undefined,
  data: WeightDataPoint[],
  range: DateRangeFilter,
): string {
  if (data.length === 0) {
    return 'No weight data available for the selected period.';
  }

  const sorted = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const current = sorted[sorted.length - 1].weightKg;
  const name = petName?.trim() || 'Pet';
  const trend = describeWeightTrend(sorted);

  return `Weight chart for ${name}. Current weight: ${current.toFixed(1)} kg. Trend: ${trend} over ${rangeLabel(range)}.`;
}

export function buildDataPointAccessibilityLabel(point: WeightDataPoint): string {
  const noteSuffix = point.note ? `. Note: ${point.note}` : '';
  return `${formatDateLabel(point.date)}: ${point.weightKg.toFixed(1)} kilograms${noteSuffix}`;
}
