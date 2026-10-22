import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';
import { getHealthCharts, HealthChartPoint } from '../services/healthService';
import { colors, spacing, typography } from '../theme';

const WEIGHT_UNIT = 'kg';
const GAP_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 30;

interface WeightMeasurement {
  id: string;
  weight: number;
  unit: string;
  measuredAt: string;
  context?: string;
}

interface ChartSegment {
  points: WeightMeasurement[];
  gapBefore: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString();
}

function buildSegments(measurements: WeightMeasurement[]): ChartSegment[] {
  const sorted = [...measurements].sort(
    (a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime(),
  );
  const segments: ChartSegment[] = [];
  let current: ChartSegment | null = null;
  let prevTime: number | null = null;

  for (const m of sorted) {
    const t = new Date(m.measuredAt).getTime();
    const gap = prevTime !== null && !Number.isNaN(t) && t - prevTime > GAP_THRESHOLD_MS;
    if (!current || gap) {
      current = { points: [], gapBefore: gap };
      segments.push(current);
    }
    current.points.push(m);
    prevTime = Number.isNaN(t) ? prevTime : t;
  }
  return segments;
}

export default function HealthChartsScreen() {
  const { token, permissions } = useAuth();
  const { isOffline, cachedHealthCharts, setCachedHealthCharts } = useOffline();
  const [measurements, setMeasurements] = useState<WeightMeasurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canView = permissions.includes('health:read');

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const data = await getHealthCharts(token);
      const weights: WeightMeasurement[] = (data.weight ?? []).map((p: HealthChartPoint) => ({
        id: p.id,
        weight: p.value,
        unit: p.unit ?? WEIGHT_UNIT,
        measuredAt: p.measuredAt,
        context: p.context,
      }));
      setMeasurements(weights);
      setCachedHealthCharts(weights);
    } catch (e) {
      if (isOffline && cachedHealthCharts) {
        setMeasurements(cachedHealthCharts as WeightMeasurement[]);
      } else {
        setError('Unable to load health charts. Pull to retry.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canView, token, isOffline, cachedHealthCharts, setCachedHealthCharts]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  useEffect(() => {
    if (isOffline && cachedHealthCharts && measurements.length === 0) {
      setMeasurements(cachedHealthCharts as WeightMeasurement[]);
    }
  }, [isOffline, cachedHealthCharts, measurements.length]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const inconsistentUnits = useMemo(() => {
    const units = new Set(measurements.map((m) => m.unit));
    return units.size > 1 ? Array.from(units) : null;
  }, [measurements]);

  const segments = useMemo(() => buildSegments(measurements), [measurements]);

  if (!canView) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText} accessibilityRole="text">
          You do not have permission to view health charts.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Loading health charts" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title} accessibilityRole="header">
        Weight History
      </Text>

      {error ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {inconsistentUnits ? (
        <View style={styles.warningBox} accessibilityRole="alert">
          <Text style={styles.warningText}>
            Mixed units detected ({inconsistentUnits.join(', ')}). Values are shown as recorded and
            are not converted.
          </Text>
        </View>
      ) : null}

      {measurements.length === 0 ? (
        <Text style={styles.emptyText} accessibilityRole="text">
          No weight measurements recorded yet.
        </Text>
      ) : (
        segments.map((segment, idx) => (
          <View key={`segment-${idx}`} style={styles.segment}>
            {segment.gapBefore ? (
              <View style={styles.gapBox} accessibilityRole="text">
                <Text style={styles.gapText}>Gap in measurements — no data recorded</Text>
              </View>
            ) : null}
            {segment.points.map((m) => (
              <View
                key={m.id}
                style={styles.row}
                accessible
                accessibilityLabel={`${m.weight} ${m.unit} on ${formatDate(
                  m.measuredAt,
                )}${m.context ? `, ${m.context}` : ''}`}
              >
                <Text style={styles.weightText}>
                  {m.weight} {m.unit}
                </Text>
                <Text style={styles.metaText}>{formatDate(m.measuredAt)}</Text>
                {m.context ? <Text style={styles.contextText}>{m.context}</Text> : null}
              </View>
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  title: { ...typography.h2, marginBottom: spacing.md },
  segment: { marginBottom: spacing.md },
  row: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  weightText: { ...typography.body, fontWeight: '600' },
  metaText: { ...typography.caption, color: colors.textMuted },
  contextText: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic' },
  gapBox: {
    padding: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    marginVertical: spacing.sm,
  },
  gapText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  warningBox: {
    padding: spacing.sm,
    backgroundColor: colors.warningSurface,
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  warningText: { ...typography.caption, color: colors.warning },
  errorText: { ...typography.caption, color: colors.error, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});
