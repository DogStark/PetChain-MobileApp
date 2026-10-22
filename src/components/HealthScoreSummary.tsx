import React from 'react';
import { View, Text, StyleSheet, AccessibilityInfo } from 'react-native';

/**
 * Health score summary card.
 *
 * Renders a numeric health score plus a short trend description. The card is
 * exposed to assistive technology as a single, meaningful summary that
 * includes the score, its unit, the trend direction, the date range the score
 * covers, and the threshold status. Empty and error states are announced so
 * screen-reader users are not left with a silent card.
 */

export type HealthScoreTrend = 'improving' | 'stable' | 'declining';

export interface HealthScoreSummaryProps {
  /** Numeric score, e.g. 82. */
  score?: number | null;
  /** Unit for the score, e.g. "points" or "%". */
  unit?: string;
  /** Trend direction over the covered period. */
  trend?: HealthScoreTrend;
  /** ISO date (inclusive) the summary starts at. */
  startDate?: string;
  /** ISO date (inclusive) the summary ends at. */
  endDate?: string;
  /** Optional threshold the score is compared against. */
  threshold?: number | null;
  /** When true, render the error state instead of a score. */
  hasError?: boolean;
  /** Optional error message to announce. */
  errorMessage?: string;
}

const TREND_LABELS: Record<HealthScoreTrend, string> = {
  improving: 'improving',
  stable: 'stable',
  declining: 'declining',
};

function formatDateRange(startDate?: string, endDate?: string): string {
  if (!startDate && !endDate) {
    return '';
  }
  if (startDate && endDate) {
    return `from ${startDate} to ${endDate}`;
  }
  if (startDate) {
    return `from ${startDate}`;
  }
  return `through ${endDate}`;
}

function buildAccessibleSummary(props: HealthScoreSummaryProps): string {
  const {
    score,
    unit,
    trend,
    startDate,
    endDate,
    threshold,
  } = props;

  const parts: string[] = [];

  if (typeof score === 'number' && Number.isFinite(score)) {
    parts.push(`Health score ${score}${unit ? ` ${unit}` : ''}`);
  } else {
    parts.push('Health score unavailable');
  }

  if (trend) {
    parts.push(`trend ${TREND_LABELS[trend]}`);
  }

  const range = formatDateRange(startDate, endDate);
  if (range) {
    parts.push(range);
  }

  if (typeof threshold === 'number' && Number.isFinite(threshold)) {
    if (typeof score === 'number' && Number.isFinite(score)) {
      parts.push(
        score >= threshold
          ? `above threshold of ${threshold}${unit ? ` ${unit}` : ''}`
          : `below threshold of ${threshold}${unit ? ` ${unit}` : ''}`,
      );
    } else {
      parts.push(`threshold ${threshold}${unit ? ` ${unit}` : ''}`);
    }
  }

  return `${parts.join(', ')}.`;
}

export const HealthScoreSummary: React.FC<HealthScoreSummaryProps> = (props) => {
  const {
    score,
    unit,
    trend,
    startDate,
    endDate,
    threshold,
    hasError,
    errorMessage,
  } = props;

  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const isEmpty = !hasError && !hasScore;

  const accessibleSummary = React.useMemo(() => {
    if (hasError) {
      return errorMessage
        ? `Health score error. ${errorMessage}`
        : 'Health score error. Unable to load health score.';
    }
    if (isEmpty) {
      return 'Health score unavailable. No health score data for this period.';
    }
    return buildAccessibleSummary(props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasError,
    errorMessage,
    isEmpty,
    score,
    unit,
    trend,
    startDate,
    endDate,
    threshold,
  ]);

  React.useEffect(() => {
    if (hasError || isEmpty) {
      AccessibilityInfo.announceForAccessibility(accessibleSummary);
    }
  }, [accessibleSummary, hasError, isEmpty]);

  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={accessibleSummary}
      accessibilityHint="Shows your health score, trend, and date range"
    >
      <Text style={styles.title}>Health Score</Text>

      {hasError ? (
        <Text style={styles.errorText}>
          {errorMessage || 'Unable to load health score.'}
        </Text>
      ) : isEmpty ? (
        <Text style={styles.emptyText}>No health score data for this period.</Text>
      ) : (
        <>
          <Text style={styles.scoreText}>
            {score}
            {unit ? <Text style={styles.unitText}> {unit}</Text> : null}
          </Text>
          {trend ? (
            <Text style={styles.trendText}>Trend: {TREND_LABELS[trend]}</Text>
          ) : null}
          {(startDate || endDate) ? (
            <Text style={styles.rangeText}>
              {formatDateRange(startDate, endDate)}
            </Text>
          ) : null}
          {typeof threshold === 'number' && Number.isFinite(threshold) ? (
            <Text style={styles.thresholdText}>
              {hasScore && score! >= threshold ? 'Above' : 'Below'} threshold of{' '}
              {threshold}
              {unit ? ` ${unit}` : ''}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
  },
  scoreText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#111827',
  },
  unitText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#6B7280',
  },
  trendText: {
    marginTop: 4,
    fontSize: 14,
    color: '#374151',
  },
  rangeText: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
  },
  thresholdText: {
    marginTop: 4,
    fontSize: 12,
    color: '#374151',
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
  },
  errorText: {
    fontSize: 14,
    color: '#B91C1C',
  },
});

export default HealthScoreSummary;
