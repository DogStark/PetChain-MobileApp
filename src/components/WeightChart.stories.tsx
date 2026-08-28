import { action } from '@storybook/addon-actions';
import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import WeightChart, { type WeightDataPoint } from './WeightChart';

/**
 * `WeightChart` — An interactive line chart visualizing a pet's weight and
 * growth trends over time.
 *
 * Features:
 * - Date range filtering (1 month, 3 months, 1 year, all time)
 * - Vet-recommended weight range overlay (shaded band)
 * - Milestone markers for significant events (surgeries, illnesses)
 * - Tap data points to view details
 * - Export chart as image for sharing with vets
 *
 * ### Props
 * | Prop | Type | Default | Description |
 * |------|------|---------|-------------|
 * | `data` | `WeightDataPoint[]` | — | Array of weight measurements with dates |
 * | `vetRecommendedRange` | `WeightRange` | — | Min/max healthy weight range |
 * | `onExport` | `() => void` | — | Callback to export chart as image |
 * | `height` | `number` | `300` | Chart height in pixels |
 *
 * ### Usage
 * ```tsx
 * <WeightChart
 *   data={weightHistory}
 *   vetRecommendedRange={{ min: 4.0, max: 5.5 }}
 *   onExport={() => shareChart()}
 * />
 * ```
 */
const meta: Meta<typeof WeightChart> = {
  title: 'Components/WeightChart',
  component: WeightChart,
  decorators: [
    (Story) => (
      <View style={{ padding: 16, backgroundColor: '#f5f5f5' }}>
        <Story />
      </View>
    ),
  ],
  argTypes: {
    height: { control: { type: 'range', min: 200, max: 500, step: 50 } },
  },
};

export default meta;

type Story = StoryObj<typeof WeightChart>;

const sampleData: WeightDataPoint[] = [
  { date: '2025-11-01T00:00:00Z', weightKg: 4.2 },
  { date: '2025-11-15T00:00:00Z', weightKg: 4.3 },
  { date: '2025-12-01T00:00:00Z', weightKg: 4.5 },
  { date: '2025-12-15T00:00:00Z', weightKg: 4.4 },
  { date: '2026-01-01T00:00:00Z', weightKg: 4.6 },
  { date: '2026-01-15T00:00:00Z', weightKg: 4.7 },
  { date: '2026-02-01T00:00:00Z', weightKg: 4.8 },
  { date: '2026-02-15T00:00:00Z', weightKg: 4.9 },
  { date: '2026-03-01T00:00:00Z', weightKg: 5.0 },
  { date: '2026-03-15T00:00:00Z', weightKg: 5.1 },
  { date: '2026-04-01T00:00:00Z', weightKg: 5.2 },
  { date: '2026-04-15T00:00:00Z', weightKg: 5.3 },
  { date: '2026-05-01T00:00:00Z', weightKg: 5.4 },
  { date: '2026-05-15T00:00:00Z', weightKg: 5.5 },
];

const dataWithAnnotations: WeightDataPoint[] = [
  { date: '2025-11-01T00:00:00Z', weightKg: 4.8 },
  { date: '2025-11-15T00:00:00Z', weightKg: 4.9 },
  { date: '2025-12-01T00:00:00Z', weightKg: 5.0 },
  { date: '2025-12-15T00:00:00Z', weightKg: 4.5, note: 'Surgery' },
  { date: '2026-01-01T00:00:00Z', weightKg: 4.6 },
  { date: '2026-01-15T00:00:00Z', weightKg: 4.7 },
  { date: '2026-02-01T00:00:00Z', weightKg: 4.8 },
  { date: '2026-02-15T00:00:00Z', weightKg: 4.3, note: 'Illness' },
  { date: '2026-03-01T00:00:00Z', weightKg: 4.5 },
  { date: '2026-03-15T00:00:00Z', weightKg: 4.7 },
  { date: '2026-04-01T00:00:00Z', weightKg: 4.9 },
  { date: '2026-04-15T00:00:00Z', weightKg: 5.0 },
  { date: '2026-05-01T00:00:00Z', weightKg: 5.1 },
];

/** Accessible view with table toggle and screen reader labels. */
export const AccessibleView: Story = {
  args: {
    data: sampleData,
    petName: 'Buddy',
    vetRecommendedRange: { min: 4.5, max: 5.5 },
    onExport: action('onExport'),
    height: 300,
  },
};

/** Steady growth trend over 6 months with vet-recommended range. */
export const SteadyGrowth: Story = {
  args: {
    data: sampleData,
    vetRecommendedRange: { min: 4.5, max: 5.5 },
    onExport: action('onExport'),
    height: 300,
  },
};

/** Weight fluctuations with annotated events (surgery, illness). */
export const WithAnnotations: Story = {
  args: {
    data: dataWithAnnotations,
    vetRecommendedRange: { min: 4.5, max: 5.2 },
    onExport: action('onExport'),
    height: 300,
  },
};

/** Single data point — minimal chart. */
export const SinglePoint: Story = {
  args: {
    data: [{ date: '2026-05-29T00:00:00Z', weightKg: 5.0 }],
    vetRecommendedRange: { min: 4.5, max: 5.5 },
    onExport: action('onExport'),
    height: 300,
  },
};

/** Empty dataset — shows "No data" message. */
export const Empty: Story = {
  args: {
    data: [],
    vetRecommendedRange: { min: 4.5, max: 5.5 },
    onExport: action('onExport'),
    height: 300,
  },
};

/** Without vet-recommended range overlay. */
export const NoVetRange: Story = {
  args: {
    data: sampleData,
    onExport: action('onExport'),
    height: 300,
  },
};

/** Taller chart for more detail. */
export const TallChart: Story = {
  args: {
    data: sampleData,
    vetRecommendedRange: { min: 4.5, max: 5.5 },
    onExport: action('onExport'),
    height: 450,
  },
};

/** Long-term data (1+ year) with many data points. */
export const LongTermData: Story = {
  args: {
    data: Array.from({ length: 24 }, (_, i) => ({
      date: new Date(2024, 5 + i, 1).toISOString(),
      weightKg: 4.0 + i * 0.08 + Math.sin(i * 0.5) * 0.2,
    })),
    vetRecommendedRange: { min: 4.5, max: 6.0 },
    onExport: action('onExport'),
    height: 300,
  },
};
