import React, { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import type { PetHealthMetric } from '../../types/pet';

type PetHealthSummaryProps = {
  metrics: PetHealthMetric[];
  isLoading?: boolean;
  error?: string | null;
};

/**
 * Formats a health metric into a screen-reader friendly sentence.
 * The numeric value is only included once so announcements never duplicate
 * the same medical value.
 */
function formatMetricLabel(metric: PetHealthMetric): string {
  const value = metric.value != null ? `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}` : 'no value recorded';
  return `${metric.label}, ${value}`;
}

export function PetHealthSummary({ metrics, isLoading = false, error = null }: PetHealthSummaryProps) {
  const hasAnnouncedRef = useRef(false);

  const summaryLabel = useMemo(() => {
    if (isLoading) {
      return 'Health summary, loading';
    }
    if (error) {
      return 'Health summary, unavailable';
    }
    if (!metrics || metrics.length === 0) {
      return 'Health summary, no metrics recorded';
    }
    return `Health summary, ${metrics.length} ${metrics.length === 1 ? 'metric' : 'metrics'}`;
  }, [error, isLoading, metrics]);

  // Announce loading, empty, and error states exactly once per transition.
  useEffect(() => {
    if (hasAnnouncedRef.current) {
      return;
    }
    if (isLoading) {
      hasAnnouncedRef.current = true;
      AccessibilityInfo.announceForAccessibility('Loading health summary');
      return;
    }
    if (error) {
      hasAnnouncedRef.current = true;
      AccessibilityInfo.announceForAccessibility('Health summary unavailable');
      return;
    }
    if (!metrics || metrics.length === 0) {
      hasAnnouncedRef.current = true;
      AccessibilityInfo.announceForAccessibility('No health metrics recorded');
    }
  }, [error, isLoading, metrics]);

  // Reset the announcement guard when the summary content changes so a new
  // state can be announced once more.
  useEffect(() => {
    hasAnnouncedRef.current = false;
  }, [isLoading, error, metrics]);

  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={summaryLabel}
      accessibilityHint="Swipe to review each health metric"
    >
      <Text style={styles.heading} accessibilityRole="header">
        Health summary
      </Text>

      {isLoading ? (
        <Text style={styles.stateText} accessibilityLiveRegion="polite">
          Loading health metrics…
        </Text>
      ) : error ? (
        <Text style={styles.stateText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : !metrics || metrics.length === 0 ? (
        <Text style={styles.stateText} accessibilityLiveRegion="polite">
          No health metrics recorded yet.
        </Text>
      ) : (
        metrics.map((metric) => (
          <View
            key={metric.id}
            style={styles.metricRow}
            accessible
            accessibilityRole="text"
            accessibilityLabel={formatMetricLabel(metric)}
          >
            <Text style={styles.metricLabel}>{metric.label}</Text>
            <Text style={styles.metricValue}>
              {metric.value != null ? `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}` : '—'}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  stateText: {
    fontSize: 14,
    color: '#666',
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  metricLabel: {
    fontSize: 15,
  },
  metricValue: {
    fontSize: 15,
    fontWeight: '500',
  },
});
