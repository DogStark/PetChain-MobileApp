/**
 * a11yChartSummary.ts
 *
 * Screen-reader equivalents for visual-only data (health charts, vet map).
 *
 * Charts and maps render as a single opaque view to assistive tech. These
 * helpers produce the non-visual equivalent required by WCAG 1.1.1 / 1.3.1:
 *  - a one-line spoken summary (trend / count / extent)
 *  - a flat, ordered "data table" list that VoiceOver / TalkBack can walk
 *  - a heading string so the region is reachable by rotor / headings nav
 *
 * All functions are pure and synchronous so they can be unit tested without a
 * renderer, and they never emit precise coordinates, contact details, or raw
 * record identifiers into the spoken string.
 */

export interface SeriesPoint {
  /** ISO date or short label shown on the x axis */
  label: string;
  value: number;
  /** Optional unit appended to the spoken value, e.g. "kg", "bpm" */
  unit?: string;
}

export type Trend = 'rising' | 'falling' | 'stable' | 'not enough data';

export interface ChartSummaryOptions {
  /** e.g. "Weight", "Resting heart rate" */
  metricName: string;
  /** Human phrase for the active filter, e.g. "last 3 months" */
  rangeLabel?: string;
  /** Value below which a change is treated as noise (same unit as points) */
  stableEpsilon?: number;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function describeTrend(points: SeriesPoint[], stableEpsilon = 0.1): Trend {
  if (points.length < 2) return 'not enough data';
  const delta = points[points.length - 1].value - points[0].value;
  if (Math.abs(delta) <= stableEpsilon) return 'stable';
  return delta > 0 ? 'rising' : 'falling';
}

/** One-line summary spoken when the chart region gains accessibility focus. */
export function buildChartSummary(
  points: SeriesPoint[],
  { metricName, rangeLabel, stableEpsilon = 0.1 }: ChartSummaryOptions,
): string {
  const scope = rangeLabel ? ` over ${rangeLabel}` : '';
  if (points.length === 0) {
    return `${metricName} chart. No data for ${rangeLabel ?? 'the selected period'}.`;
  }

  const values = points.map((p) => p.value);
  const unit = points[0].unit ? ` ${points[0].unit}` : '';
  const min = round(Math.min(...values));
  const max = round(Math.max(...values));
  const latest = round(values[values.length - 1]);
  const trend = describeTrend(points, stableEpsilon);

  return (
    `${metricName} chart${scope}. ${points.length} ` +
    `${points.length === 1 ? 'reading' : 'readings'}. ` +
    `Latest ${latest}${unit}. Trend ${trend}. ` +
    `Range ${min}${unit} to ${max}${unit}.`
  );
}

/**
 * Flat list of spoken rows equivalent to the plotted points. Render each string
 * as its own focusable element so the series can be read point by point.
 */
export function buildChartDataTable(points: SeriesPoint[]): string[] {
  return points.map((p, i) => {
    const unit = p.unit ? ` ${p.unit}` : '';
    return `Point ${i + 1} of ${points.length}. ${p.label}: ${round(p.value)}${unit}.`;
  });
}

export interface MapClinicLike {
  name: string;
  type: string;
  address: string;
  available24h?: boolean;
  /** distance in km */
  distance?: number;
  estimatedTravelMinutes?: number;
}

export interface MapSummaryOptions {
  /** Active filter label, e.g. "Emergency" or "All" */
  filterLabel: string;
  /** Whether the device is currently offline (data may be cached) */
  offline?: boolean;
}

/** One-line summary for the map region; mirrors the visible pin set + filter. */
export function buildMapSummary(
  clinics: MapClinicLike[],
  { filterLabel, offline = false }: MapSummaryOptions,
): string {
  const source = offline ? ' Showing cached results; you are offline.' : '';
  if (clinics.length === 0) {
    return `Vet map. No ${filterLabel.toLowerCase()} locations found nearby.${source}`;
  }

  const nearest = [...clinics]
    .filter((c) => typeof c.distance === 'number')
    .sort((a, b) => (a.distance as number) - (b.distance as number))[0];
  const nearestPhrase = nearest
    ? ` Nearest: ${nearest.name}, ${round(nearest.distance as number)} kilometers away.`
    : '';

  return (
    `Vet map. ${clinics.length} ${filterLabel.toLowerCase()} ` +
    `${clinics.length === 1 ? 'location' : 'locations'} nearby.${nearestPhrase}${source}`
  );
}

/**
 * List equivalent of the map pins, ordered nearest-first. Each string is one
 * row for the screen reader; no latitude/longitude or phone number is spoken.
 */
export function buildClinicListSummary(clinics: MapClinicLike[]): string[] {
  return [...clinics]
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
    .map((c, i) => {
      const dist =
        typeof c.distance === 'number' ? `, ${round(c.distance)} kilometers` : '';
      const eta =
        typeof c.estimatedTravelMinutes === 'number'
          ? `, about ${c.estimatedTravelMinutes} minutes away`
          : '';
      const hours = c.available24h ? ', open 24 hours' : '';
      return `${i + 1} of ${clinics.length}. ${c.name}. ${c.type}${dist}${eta}${hours}. ${c.address}.`;
    });
}

/** Semantic heading text for a data region (use with accessibilityRole="header"). */
export function sectionHeading(title: string, count?: number): string {
  return typeof count === 'number' ? `${title} (${count})` : title;
}
