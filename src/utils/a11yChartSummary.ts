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
  /** Whether the device is offline and showing cached readings */
  offline?: boolean;
  /** Whether the displayed readings may be stale */
  stale?: boolean;
  /** Server-confirmed user permissions (if supplied, enforces requiredPermission) */
  permissions?: string[];
  /** Required permission to view the chart (defaults to "health:read") */
  requiredPermission?: string;
}

export interface AccessibleChartTableRow {
  index: number;
  total: number;
  dateText: string;
  valueText: string;
  unit: string;
  stepTrend: Trend;
  /** Non-color text+symbol indicator (e.g. "↑ Rising", "↓ Falling", "→ Stable") */
  stepTrendBadge: string;
  deltaText: string;
  spokenRow: string;
}

export interface AccessibleChartTableOptions {
  stableEpsilon?: number;
  permissions?: string[];
  requiredPermission?: string;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Non-color indicator string pairing a directional glyph with an explicit word
 * so sighted, low-vision, and screen-reader users never rely on color alone.
 */
export function formatTrendBadge(trend: Trend): string {
  switch (trend) {
    case 'rising':
      return '↑ Rising';
    case 'falling':
      return '↓ Falling';
    case 'stable':
      return '→ Stable';
    default:
      return '— Not enough data';
  }
}

export function describeTrend(points: SeriesPoint[], stableEpsilon = 0.1): Trend {
  const valid = points.filter((p) => Number.isFinite(p.value));
  if (valid.length < 2) return 'not enough data';
  const delta = valid[valid.length - 1].value - valid[0].value;
  if (Math.abs(delta) <= stableEpsilon) return 'stable';
  return delta > 0 ? 'rising' : 'falling';
}

function hasRequiredPermission(permissions?: string[], requiredPermission = 'health:read'): boolean {
  if (!Array.isArray(permissions)) return true;
  return permissions.includes(requiredPermission);
}

/** One-line summary spoken when the chart region gains accessibility focus. */
export function buildChartSummary(
  points: SeriesPoint[],
  {
    metricName,
    rangeLabel,
    stableEpsilon = 0.1,
    offline = false,
    stale = false,
    permissions,
    requiredPermission = 'health:read',
  }: ChartSummaryOptions,
): string {
  if (!hasRequiredPermission(permissions, requiredPermission)) {
    return 'Permission denied. You do not have access to view health charts.';
  }

  const statusSuffix = [
    offline ? 'Showing cached readings; you are offline.' : '',
    stale ? 'Data may be stale.' : '',
  ]
    .filter(Boolean)
    .map((s) => ` ${s}`)
    .join('');

  const scope = rangeLabel ? ` over ${rangeLabel}` : '';
  const validPoints = points.filter((p) => Number.isFinite(p.value));
  if (validPoints.length === 0) {
    return `${metricName} chart. No data for ${rangeLabel ?? 'the selected period'}.${statusSuffix}`;
  }

  const distinctUnits = Array.from(
    new Set(validPoints.map((p) => (p.unit ?? '').trim()).filter(Boolean)),
  );
  if (distinctUnits.length > 1) {
    return (
      `${metricName} chart${scope}. ${validPoints.length} ` +
      `${validPoints.length === 1 ? 'reading' : 'readings'}. ` +
      `Mixed units detected (${distinctUnits.join(', ')}); trend and range omitted to avoid unit mismatch.${statusSuffix}`
    );
  }

  const values = validPoints.map((p) => p.value);
  const unit = distinctUnits[0] ? ` ${distinctUnits[0]}` : '';
  const min = round(Math.min(...values));
  const max = round(Math.max(...values));
  const latest = round(values[values.length - 1]);
  const trend = describeTrend(validPoints, stableEpsilon);

  return (
    `${metricName} chart${scope}. ${validPoints.length} ` +
    `${validPoints.length === 1 ? 'reading' : 'readings'}. ` +
    `Latest ${latest}${unit}. Trend ${trend}. ` +
    `Range ${min}${unit} to ${max}${unit}.${statusSuffix}`
  );
}

/**
 * Flat list of spoken rows equivalent to the plotted points. Render each string
 * as its own focusable element so the series can be read point by point.
 */
export function buildChartDataTable(points: SeriesPoint[]): string[] {
  const validPoints = points.filter((p) => Number.isFinite(p.value));
  return validPoints.map((p, i) => {
    const unit = p.unit ? ` ${p.unit}` : '';
    return `Point ${i + 1} of ${validPoints.length}. ${p.label}: ${round(p.value)}${unit}.`;
  });
}

/**
 * Structured accessible data-table rows with dates, units, and non-color
 * step-to-step trend/delta indicators. Respects server-confirmed permissions
 * and strips any unverified/raw fields by default.
 */
export function buildAccessibleChartTable(
  points: SeriesPoint[],
  options: AccessibleChartTableOptions = {},
): AccessibleChartTableRow[] {
  const {
    stableEpsilon = 0.1,
    permissions,
    requiredPermission = 'health:read',
  } = options;

  if (!hasRequiredPermission(permissions, requiredPermission)) {
    return [];
  }

  const validPoints = points.filter((p) => Number.isFinite(p.value));
  const total = validPoints.length;

  return validPoints.map((p, idx) => {
    const unit = (p.unit ?? '').trim();
    const rounded = round(p.value);
    const valueText = unit ? `${rounded} ${unit}` : `${rounded}`;
    const dateText = (p.label || 'Unknown date').trim();

    let stepTrend: Trend = 'not enough data';
    let deltaText = 'Baseline reading';

    if (idx > 0) {
      const prev = validPoints[idx - 1];
      const prevUnit = (prev.unit ?? '').trim();
      if (prevUnit !== unit) {
        stepTrend = 'not enough data';
        deltaText = `Unit changed (${prevUnit || 'none'} to ${unit || 'none'})`;
      } else {
        const rawDelta = round(p.value - prev.value);
        if (Math.abs(rawDelta) <= stableEpsilon) {
          stepTrend = 'stable';
          deltaText = `No significant change (${rawDelta >= 0 ? '+' : ''}${rawDelta}${unit ? ` ${unit}` : ''})`;
        } else if (rawDelta > 0) {
          stepTrend = 'rising';
          deltaText = `+${rawDelta}${unit ? ` ${unit}` : ''}`;
        } else {
          stepTrend = 'falling';
          deltaText = `${rawDelta}${unit ? ` ${unit}` : ''}`;
        }
      }
    }

    const stepTrendBadge = formatTrendBadge(stepTrend);
    const spokenRow =
      `Row ${idx + 1} of ${total}. Date: ${dateText}. ` +
      `Value: ${valueText}. Trend: ${stepTrend} (${deltaText}).`;

    return {
      index: idx + 1,
      total,
      dateText,
      valueText,
      unit,
      stepTrend,
      stepTrendBadge,
      deltaText,
      spokenRow,
    };
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
