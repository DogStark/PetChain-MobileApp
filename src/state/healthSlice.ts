import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../services/api';

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
  id: string;
  value: number;
  unit: WeightUnit;
  measuredAt: string;
  context?: string;
  // true when this point follows a gap in the series (no interpolation)
  isGap?: boolean;
}

export interface WeightChartData {
  points: WeightChartPoint[];
  units: WeightUnit[];
  hasInconsistentUnits: boolean;
  hasGaps: boolean;
}

interface HealthState {
  measurements: WeightMeasurement[];
  chart: WeightChartData | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: string | null;
}

const initialState: HealthState = {
  measurements: [],
  chart: null,
  loading: false,
  error: null,
  lastFetchedAt: null,
};

// Gap threshold: measurements more than this many days apart are treated as a gap.
const GAP_THRESHOLD_DAYS = 30;

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Build chart data from raw measurements without fabricating interpolated
 * values. Missing measurements become explicit gaps, and inconsistent units
 * are surfaced rather than silently converted or merged.
 */
export function buildWeightChart(measurements: WeightMeasurement[]): WeightChartData {
  const sorted = [...measurements].sort(
    (a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime(),
  );

  const units = Array.from(new Set(sorted.map((m) => m.unit)));
  const hasInconsistentUnits = units.length > 1;

  let hasGaps = false;
  const points: WeightChartPoint[] = sorted.map((m, index) => {
    const prev = index > 0 ? sorted[index - 1] : null;
    const isGap = prev ? daysBetween(prev.measuredAt, m.measuredAt) > GAP_THRESHOLD_DAYS : false;
    if (isGap) hasGaps = true;
    return {
      id: m.id,
      value: m.value,
      unit: m.unit,
      measuredAt: m.measuredAt,
      context: m.context,
      isGap,
    };
  });

  return { points, units, hasInconsistentUnits, hasGaps };
}

export const fetchWeightMeasurements = createAsyncThunk<
  WeightMeasurement[],
  string,
  { rejectValue: string }
>('health/fetchWeightMeasurements', async (petId, { rejectWithValue }) => {
  try {
    const response = await api.get(`/pets/${petId}/weight-measurements`);
    return response.data as WeightMeasurement[];
  } catch (err: any) {
    return rejectWithValue(err?.message ?? 'Failed to load weight measurements');
  }
});

const healthSlice = createSlice({
  name: 'health',
  initialState,
  reducers: {
    addWeightMeasurement(state, action: PayloadAction<WeightMeasurement>) {
      state.measurements.push(action.payload);
      state.chart = buildWeightChart(state.measurements);
    },
    clearWeightMeasurements(state) {
      state.measurements = [];
      state.chart = null;
      state.error = null;
      state.lastFetchedAt = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWeightMeasurements.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchWeightMeasurements.fulfilled, (state, action) => {
        state.loading = false;
        state.measurements = action.payload;
        state.chart = buildWeightChart(action.payload);
        state.lastFetchedAt = new Date().toISOString();
      })
      .addCase(fetchWeightMeasurements.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? 'Failed to load weight measurements';
      });
  },
});

export const { addWeightMeasurement, clearWeightMeasurements } = healthSlice.actions;
export default healthSlice.reducer;
