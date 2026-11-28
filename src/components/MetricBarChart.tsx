import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../theme';
import {
  buildChartDataTable,
  buildChartSummary,
  describeTrend,
  formatTrendBadge,
  type SeriesPoint,
} from '../utils/a11yChartSummary';

export interface ChartPoint {
  label: string;
  value: number;
}

interface Props {
  points: ChartPoint[];
  color: string;
  unit?: string;
  height?: number;
  metricName?: string;
  rangeLabel?: string;
}

const MetricBarChart: React.FC<Props> = ({
  points,
  color,
  unit = '',
  height = 168,
  metricName = 'Health metric',
  rangeLabel,
}) => {
  const colors = useAppTheme();

  const lastN = points.slice(-14);
  const seriesPoints: SeriesPoint[] = lastN.map((p) => ({
    label: p.label,
    value: p.value,
    unit: unit || undefined,
  }));

  const summary = buildChartSummary(seriesPoints, { metricName, rangeLabel });

  if (points.length === 0) {
    return (
      <Text
        style={[styles.empty, { color: colors.placeholder }]}
        accessible
        accessibilityRole="summary"
        accessibilityLabel={summary}
      >
        No data points for this metric yet.
      </Text>
    );
  }

  const values = lastN.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const labelBand = 28;
  const barMax = Math.max(48, height - labelBand);

  const rowStrings = buildChartDataTable(seriesPoints);
  const trendBadge = formatTrendBadge(describeTrend(seriesPoints));

  return (
    <View style={styles.wrap}>
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={summary}
        style={styles.summaryRow}
      >
        <Text style={[styles.trendHint, { color: colors.secondaryText }]}>
          Trend: {trendBadge}
        </Text>
        {unit ? (
          <Text style={[styles.unitHint, { color: colors.placeholder }]}>Unit: {unit}</Text>
        ) : null}
      </View>
      <View style={[styles.barsRow, { height: barMax }]}>
        {lastN.map((p, i) => {
          const h = ((p.value - min) / span) * barMax * 0.82 + barMax * 0.12;
          return (
            <View
              key={`${p.label}-${i}`}
              style={styles.barCol}
              accessible
              accessibilityLabel={rowStrings[i]}
            >
              <View style={[styles.bar, { height: Math.max(6, h), backgroundColor: color }]} />
            </View>
          );
        })}
      </View>
      <View style={styles.labelsRow} importantForAccessibility="no-hide-descendants">
        {lastN.map((p, i) => (
          <Text
            key={`lbl-${i}`}
            style={[styles.barLabel, { color: colors.secondaryText }]}
            numberOfLines={1}
          >
            {p.label}
          </Text>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginVertical: 8 },
  empty: { fontSize: 14, paddingVertical: 12, textAlign: 'center' },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  trendHint: { fontSize: 12, fontWeight: '600' },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  barCol: { flex: 1, alignItems: 'center', marginHorizontal: 1 },
  bar: { width: '78%', borderRadius: 4, minHeight: 6 },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingHorizontal: 2,
  },
  barLabel: { flex: 1, fontSize: 9, textAlign: 'center' },
  unitHint: { fontSize: 12, textAlign: 'right' },
});

export default MetricBarChart;
