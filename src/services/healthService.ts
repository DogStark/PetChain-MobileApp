import { apiClient } from './apiClient';

export type WeightUnit = 'kg' | 'lb';

export interface WeightMeasurement {
  id: string;
  petId: string;
  value: number;
  unit: WeightUnit;
  measuredAt: string;
  context?: string;
}

export interface WeightChartPoint {
  measuredAt: string;
  value: number | null;
  unit: WeightUnit | null;
  context?: string;
  isGap: boolean;
}

export interface WeightChartSeries {
  points: WeightChartPoint[];
  hasGaps: boolean;
  inconsistentUnits: boolean;
  units: WeightUnit[];
}

export interface WeightChartOptions {
  /** Maximum allowed gap between measurements before a gap point is inserted. */
  maxGapMs?: number;
}

const DEFAULT_MAX_GAP_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * Fetch weight measurements for a pet. Permissions are confirmed server-side;
 * the client only renders what the server returns.
 */
export async function fetchWeightMeasurements(petId: string): Promise<WeightMeasurement[]> {
  const response = await apiClient.get<{ measurements: WeightMeasurement[] }>(
    `/pets/${encodeURIComponent(petId)}/weights`,
  );
  return response.data.measurements ?? [];
}

/**
 * Build a chart series from weight measurements.
 *
 * - Preserves the unit, measurement date, and optional context of each point.
 * - Inserts explicit gap points when measurements are missing instead of
 *   interpolating fabricated values.
 * - Flags inconsistent units rather than silently converting or merging them.
 */
export function buildWeightChartSeries(
  measurements: WeightMeasurement[],
  options: WeightChartOptions = {},
): WeightChartSeries {
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;

  const sorted = [...measurements].sort(
    (a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime(),
  );

  const units = Array.from(new Set(sorted.map((m) => m.unit)));
  const inconsistentUnits = units.length > 1;

  const points: WeightChartPoint[] = [];
  let hasGaps = false;

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];

    if (i > 0) {
      const previous = sorted[i - 1];
      const delta =
        new Date(current.measuredAt).getTime() - new Date(previous.measuredAt).getTime();

      if (delta > maxGapMs) {
        hasGaps = true;
        points.push({
          measuredAt: previous.measuredAt,
          value: null,
          unit: null,
          isGap: true,
        });
      }
    }

    points.push({
      measuredAt: current.measuredAt,
      value: current.value,
      unit: current.unit,
      context: current.context,
      isGap: false,
    });
  }

  return { points, hasGaps, inconsistentUnits, units };
}
