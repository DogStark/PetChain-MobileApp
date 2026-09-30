/**
 * Health-chart unit & provenance guards (issue #968)
 *
 * Prevents a chart from silently aggregating data points that are not
 * comparable — mixing kg with lb on a weight trend, or plotting different
 * biomarkers on one health series. Callers either normalize explicitly to a
 * single canonical unit, or keep the series separate and label its provenance.
 */

export type WeightUnit = 'kg' | 'lb';

/** 1 pound in kilograms (exact, international avoirdupois pound). */
export const KG_PER_LB = 0.45359237;

export interface RawWeightPoint {
  date: string;
  /** Weight in `unit`; if `unit` is omitted the value is assumed to be kg. */
  weight: number;
  unit?: WeightUnit;
  /** Where the reading came from (e.g. "clinic-scale", "owner-entry", "wearable"). */
  source?: string;
  note?: string;
}

export interface NormalizedWeightPoint {
  date: string;
  weightKg: number;
  /** The unit the reading was originally recorded in. */
  sourceUnit: WeightUnit;
  source?: string;
  note?: string;
}

/** Converts a weight reading to kilograms. */
export function toKilograms(value: number, unit: WeightUnit): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Weight value must be finite, received ${value}`);
  }
  return unit === 'lb' ? value * KG_PER_LB : value;
}

/**
 * Normalizes a mixed-unit weight series to a single canonical unit (kg) so the
 * chart never plots kg and lb on the same axis. Each point keeps its
 * `sourceUnit` for provenance labelling.
 */
export function normalizeWeightSeries(points: RawWeightPoint[]): NormalizedWeightPoint[] {
  return points.map((p) => {
    const unit: WeightUnit = p.unit ?? 'kg';
    return {
      date: p.date,
      weightKg: Number(toKilograms(p.weight, unit).toFixed(4)),
      sourceUnit: unit,
      source: p.source,
      note: p.note,
    };
  });
}

/** True when a normalized series was built from more than one source unit. */
export function seriesHasMixedUnits(points: RawWeightPoint[]): boolean {
  const units = new Set(points.map((p) => p.unit ?? 'kg'));
  return units.size > 1;
}

/** Human-readable provenance suffix for a data point, e.g. "(entered in lb)". */
export function describeProvenance(point: NormalizedWeightPoint): string {
  const parts: string[] = [];
  if (point.sourceUnit === 'lb') parts.push('entered in lb');
  if (point.source) parts.push(point.source);
  return parts.length ? `(${parts.join(', ')})` : '';
}

// ─── Biomarker compatibility ────────────────────────────────────────────────

export class IncompatibleSeriesError extends Error {
  readonly code = 'INCOMPATIBLE_SERIES';
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleSeriesError';
  }
}

export interface BiomarkerPoint {
  date: string;
  value: number;
  /** e.g. "health-score", "weight", "glucose". */
  biomarker?: string;
  unit?: string;
}

/**
 * Guards a single-series chart against plotting differing biomarkers or units
 * together. Returns the shared `{ biomarker, unit }`, or throws when the series
 * is not homogeneous.
 */
export function assertHomogeneousBiomarker(points: BiomarkerPoint[]): {
  biomarker?: string;
  unit?: string;
} {
  const biomarkers = new Set(points.map((p) => p.biomarker).filter(Boolean));
  const units = new Set(points.map((p) => p.unit).filter(Boolean));

  if (biomarkers.size > 1) {
    throw new IncompatibleSeriesError(
      `Cannot aggregate different biomarkers on one series: ${[...biomarkers].join(', ')}`,
    );
  }
  if (units.size > 1) {
    throw new IncompatibleSeriesError(
      `Cannot aggregate different units on one series: ${[...units].join(', ')}`,
    );
  }
  return { biomarker: [...biomarkers][0], unit: [...units][0] };
}
