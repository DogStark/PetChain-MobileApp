import apiClient from './apiClient';

/**
 * Pet model returned by backend APIs.
 */
export interface Pet {
  id: string;
  name: string;
  species: string;
  breed?: string;
  age?: number;
  weight?: number;
  color?: string;
  qrCode: string;
  ownerId: string;
  medicalHistory?: MedicalRecord[];
  createdAt: string;
  updatedAt: string;
}


/**
 * Medical record for a pet.
 */
export interface MedicalRecord {
  id: string;
  date: string;
  type: string;
  description: string;
  veterinarian?: string;
}

/**
 * Payload for creating a new pet.
 */
export interface CreatePetInput {
  name: string;
  species: string;
  breed?: string;
  age?: number;
  weight?: number;
  color?: string;
  ownerId: string;
}

/**
 * Payload for updating a pet.
 */
export interface UpdatePetInput {
  name?: string;
  species?: string;
  breed?: string;
  age?: number;
  weight?: number;
  color?: string;
  medicalHistory?: MedicalRecord[];
}

/**
 * API response wrapper.
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * A single health data point for chart summaries.
 */
export interface HealthChartPoint {
  date: string;
  value: number;
  unit: string;
}

/**
 * Accessible summary of a pet health chart. Does not rely on color.
 */
export interface AccessibleChartSummary {
  metric: string;
  unit: string;
  pointCount: number;
  firstDate?: string;
  lastDate?: string;
  minValue?: number;
  maxValue?: number;
  latestValue?: number;
  trend: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data';
  summaryText: string;
  table: { headers: string[]; rows: string[][] };
  isStale: boolean;
}

/**
 * Builds a screen-reader friendly summary and data table from chart points.
 * Pure function: no color, units and dates are always included.
 */
export function buildAccessibleChartSummary(
  metric: string,
  unit: string,
  points: HealthChartPoint[],
  options: { staleAfterMs?: number; now?: number; lastUpdatedAt?: number } = {},
): AccessibleChartSummary {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const now = options.now ?? Date.now();
  const isStale =
    options.staleAfterMs !== undefined &&
    options.lastUpdatedAt !== undefined &&
    now - options.lastUpdatedAt > options.staleAfterMs;

  const table = {
    headers: ['Date', `Value (${unit})`],
    rows: sorted.map((p) => [p.date, `${p.value} ${unit}`]),
  };

  if (sorted.length === 0) {
    return {
      metric,
      unit,
      pointCount: 0,
      trend: 'insufficient_data',
      summaryText: `No ${metric} data recorded.`,
      table,
      isStale,
    };
  }

  const values = sorted.map((p) => p.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const latestValue = values[values.length - 1];
  const firstDate = sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;

  let trend: AccessibleChartSummary['trend'] = 'insufficient_data';
  if (sorted.length >= 2) {
    const first = values[0];
    const delta = latestValue - first;
    const threshold = Math.max(Math.abs(first) * 0.02, 0.0001);
    if (Math.abs(delta) <= threshold) {
      trend = 'stable';
    } else {
      trend = delta > 0 ? 'increasing' : 'decreasing';
    }
  }

  const trendPhrase =
    trend === 'insufficient_data'
      ? 'Not enough data to determine a trend'
      : trend === 'stable'
        ? 'Trend is stable'
        : `Trend is ${trend}`;

  const summaryText =
    `${metric}: ${sorted.length} readings from ${firstDate} to ${lastDate}. ` +
    `Latest ${latestValue} ${unit}. Range ${minValue} to ${maxValue} ${unit}. ` +
    `${trendPhrase}.` +
    (isStale ? ' Data may be out of date.' : '');

  return {
    metric,
    unit,
    pointCount: sorted.length,
    firstDate,
    lastDate,
    minValue,
    maxValue,
    latestValue,
    trend,
    summaryText,
    table,
    isStale,
  };
}

/**
 * Fetches health chart points for a pet. Requires server-confirmed access;
 * a 401/403 response is surfaced as a permission denial rather than leaking data.
 */
export async function getPetHealthChartPoints(
  petId: string,
  metric: string,
): Promise<ApiResponse<HealthChartPoint[]>> {
  try {
    const response = await apiClient.get<ApiResponse<HealthChartPoint[]>>(
      `/pets/${encodeURIComponent(petId)}/health-charts/${encodeURIComponent(metric)}`,
    );
    return response.data;
  } catch (error: any) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      return { success: false, error: 'permission_denied', message: 'Access to this pet\'s health data was denied.' };
    }
    return { success: false, error: 'request_failed', message: error?.message ?? 'Failed to load chart data.' };
  }
}
