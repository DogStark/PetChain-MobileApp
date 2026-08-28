import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';

import MetricBarChart, { type ChartPoint } from './MetricBarChart';

/**
 * `MetricBarChart` — A lightweight bar chart for displaying pet health metrics
 * over time (e.g. weight, heart rate, activity).
 *
 * Renders up to the last 14 data points. Bars are scaled relative to the
 * min/max values in the dataset.
 *
 * ### Props
 * | Prop | Type | Default | Description |
 * |------|------|---------|-------------|
 * | `points` | `ChartPoint[]` | — | Array of `{ label, value }` data points |
 * | `color` | `string` | — | Bar fill colour (hex / named) |
 * | `unit` | `string` | `""` | Unit label shown below the chart |
 * | `height` | `number` | `168` | Total chart height in dp |
 *
 * ### Usage
 * ```tsx
 * <MetricBarChart
 *   points={[{ label: 'Mon', value: 4.2 }, { label: 'Tue', value: 4.5 }]}
 *   color="#4CAF50"
 *   unit="kg"
 * />
 * ```
 */
const meta: Meta<typeof MetricBarChart> = {
  title: 'Components/MetricBarChart',
  component: MetricBarChart,
  decorators: [
    (Story) => (
      <View style={{ padding: 16, backgroundColor: '#fff' }}>
        <Story />
      </View>
    ),
  ],
  argTypes: {
    color: { control: 'color' },
    unit: { control: 'text' },
    height: { control: { type: 'range', min: 80, max: 300, step: 8 } },
  },
};

export default meta;

type Story = StoryObj<typeof MetricBarChart>;

const weightPoints: ChartPoint[] = [
  { label: 'Jan 1', value: 4.1 },
  { label: 'Jan 8', value: 4.3 },
  { label: 'Jan 15', value: 4.2 },
  { label: 'Jan 22', value: 4.5 },
  { label: 'Jan 29', value: 4.4 },
  { label: 'Feb 5', value: 4.6 },
  { label: 'Feb 12', value: 4.7 },
];

/** Weight trend over several weeks. */
export const WeightTrend: Story = {
  args: {
    points: weightPoints,
    color: '#4CAF50',
    unit: 'kg',
    height: 168,
  },
};

const heartRatePoints: ChartPoint[] = Array.from({ length: 14 }, (_, i) => ({
  label: `D${i + 1}`,
  value: 60 + Math.round(Math.sin(i * 0.5) * 15 + Math.random() * 5),
}));

/** Heart rate data with 14 points (maximum displayed). */
export const HeartRate: Story = {
  args: {
    points: heartRatePoints,
    color: '#e53e3e',
    unit: 'bpm',
    height: 200,
  },
};

/** Single data point — bar fills to maximum height. */
export const SinglePoint: Story = {
  args: {
    points: [{ label: 'Today', value: 5.0 }],
    color: '#4A90A4',
    unit: 'kg',
  },
};

/** Empty dataset renders the "No data" placeholder text. */
export const Empty: Story = {
  args: {
    points: [],
    color: '#4CAF50',
    unit: 'kg',
  },
};
