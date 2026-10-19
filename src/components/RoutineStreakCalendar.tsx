import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import SkeletonCard from './SkeletonCard';
import EmptyState from './EmptyState';
import StateView from './StateView';
import { useReducedMotion } from '../hooks/useReducedMotion';
import {
  RoutineDayState,
  RoutineStreakDay,
  buildMonthGrid,
  formatDayAccessibilityLabel,
  getMonthLabel,
  getNextMonth,
  getPreviousMonth,
  isSameDay,
} from '../utils/routineStreak';

export type RoutineStreakCalendarProps = {
  /** Days of routine data keyed by ISO date (YYYY-MM-DD). Missing keys are "unknown". */
  days?: Record<string, RoutineStreakDay>;
  /** Currently focused month (first day of month). */
  month?: Date;
  /** Currently selected day, if any. */
  selectedDate?: Date | null;
  /** Loading state for the month's data. */
  loading?: boolean;
  /** Permission denied state (server-confirmed). */
  permissionDenied?: boolean;
  /** Server error state. */
  error?: string | null;
  /** Stale/offline data indicator. */
  isStale?: boolean;
  /** Called when the user navigates to a different month. */
  onMonthChange?: (month: Date) => void;
  /** Called when the user selects a day. */
  onSelectDay?: (date: Date) => void;
  /** Non-destructive retry handler. */
  onRetry?: () => void;
};

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resolveDayState(
  days: Record<string, RoutineStreakDay> | undefined,
  date: Date,
): RoutineDayState {
  if (!days) return 'unknown';
  const entry = days[toIsoDate(date)];
  if (!entry) return 'unknown';
  return entry.state;
}

const STATE_STYLES: Record<
  RoutineDayState,
  { container: string; label: string; glyph: string }
> = {
  completed: {
    container: 'completed',
    label: 'completed',
    glyph: '✓',
  },
  skipped: {
    container: 'skipped',
    label: 'skipped',
    glyph: '–',
  },
  unknown: {
    container: 'unknown',
    label: 'no data recorded',
    glyph: '•',
  },
};

export default function RoutineStreakCalendar({
  days,
  month,
  selectedDate,
  loading = false,
  permissionDenied = false,
  error = null,
  isStale = false,
  onMonthChange,
  onSelectDay,
  onRetry,
}: RoutineStreakCalendarProps) {
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();

  const initialMonth = useMemo(() => {
    const base = month ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }, [month]);

  const [internalMonth, setInternalMonth] = useState<Date>(initialMonth);

  // Keep internal month in sync when a controlled month prop changes.
  const activeMonth = month
    ? new Date(month.getFullYear(), month.getMonth(), 1)
    : internalMonth;

  const handleMonthChange = useCallback(
    (next: Date) => {
      if (!month) {
        setInternalMonth(next);
      }
      onMonthChange?.(next);
    },
    [month, onMonthChange],
  );

  const handlePrev = useCallback(() => {
    handleMonthChange(getPreviousMonth(activeMonth));
  }, [activeMonth, handleMonthChange]);

  const handleNext = useCallback(() => {
    handleMonthChange(getNextMonth(activeMonth));
  }, [activeMonth, handleMonthChange]);

  const handleSelect = useCallback(
    (date: Date) => {
      onSelectDay?.(date);
    },
    [onSelectDay],
  );

  const grid = useMemo(() => buildMonthGrid(activeMonth), [activeMonth]);
  const monthLabel = useMemo(() => getMonthLabel(activeMonth), [activeMonth]);

  const cellSize = useMemo(() => {
    const horizontalPadding = 32;
    const gap = 4;
    const available = Math.max(width - horizontalPadding, 240);
    return Math.floor((available - gap * 6) / 7);
  }, [width]);

  if (permissionDenied) {
    return (
      <StateView
        kind="permission-denied"
        title="Routine history unavailable"
        message="You don't have permission to view this pet's routine history."
        actionLabel={onRetry ? 'Retry' : undefined}
        onAction={onRetry}
      />
    );
  }

  if (error) {
    return (
      <StateView
        kind="error"
        title="Couldn't load routine history"
        message={error}
        actionLabel={onRetry ? 'Retry' : undefined}
        onAction={onRetry}
      />
    );
  }

  const hasAnyData = useMemo(() => {
    if (!days) return false;
    return Object.keys(days).length > 0;
  }, [days]);

  return (
    <View style={styles.container}>
      {isStale ? (
        <StateView
          kind="offline"
          title="Showing saved data"
          message="You're offline. Routine history may be out of date."
          actionLabel={onRetry ? 'Retry' : undefined}
          onAction={onRetry}
        />
      ) : null}

      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          accessibilityHint="Shows the previous month of routine history"
          onPress={handlePrev}
          style={({ pressed }) => [
            styles.navButton,
            pressed && styles.navButtonPressed,
          ]}
          hitSlop={8}
        >
          <Text style={styles.navButtonText}>{'‹'}</Text>
        </Pressable>

        <Text
          style={styles.monthLabel}
          accessibilityRole="header"
          accessibilityLabel={monthLabel}
        >
          {monthLabel}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityHint="Shows the next month of routine history"
          onPress={handleNext}
          style={({ pressed }) => [
            styles.navButton,
            pressed && styles.navButtonPressed,
          ]}
          hitSlop={8}
        >
          <Text style={styles.navButtonText}>{'›'}</Text>
        </Pressable>
      </View>

      <View style={styles.weekdayRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {WEEKDAY_LABELS.map((label, index) => (
          <View key={`${label}-${index}`} style={[styles.weekdayCell, { width: cellSize }]}>
            <Text style={styles.weekdayText}>{label}</Text>
          </View>
        ))}
      </View>

      {loading ? (
        <SkeletonCard height={cellSize * 5} />
      ) : !hasAnyData ? (
        <EmptyState
          title="No routine history yet"
          message="Completed and skipped care events will appear here."
        />
      ) : (
        <View style={styles.grid}>
          {grid.map((week, weekIndex) => (
            <View key={`week-${weekIndex}`} style={styles.weekRow}>
              {week.map((cell, dayIndex) => {
                if (!cell) {
                  return (
                    <View
                      key={`empty-${weekIndex}-${dayIndex}`}
                      style={[styles.dayCell, { width: cellSize, height: cellSize }]}
                    />
                  );
                }

                const state = resolveDayState(days, cell);
                const stateStyle = STATE_STYLES[state];
                const isSelected = selectedDate ? isSameDay(selectedDate, cell) : false;
                const accessibilityLabel = formatDayAccessibilityLabel(cell, state);

                return (
                  <Pressable
                    key={toIsoDate(cell)}
                    accessibilityRole="button"
                    accessibilityLabel={accessibilityLabel}
                    accessibilityHint="Selects this day to view routine details"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => handleSelect(cell)}
                    style={({ pressed }) => [
                      styles.dayCell,
                      { width: cellSize, height: cellSize },
                      styles[stateStyle.container as keyof typeof styles],
                      isSelected && styles.dayCellSelected,
                      pressed && !reducedMotion && styles.dayCellPressed,
                    ]}
                  >
                    <Text style={styles.dayNumber}>{cell.getDate()}</Text>
                    <Text
                      style={[
                        styles.dayGlyph,
                        state === 'completed' && styles.glyphCompleted,
                        state === 'skipped' && styles.glyphSkipped,
                        state === 'unknown' && styles.glyphUnknown,
                      ]}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      {stateStyle.glyph}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      )}

      <View style={styles.legend} accessibilityRole="summary">
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.completed]} />
          <Text style={styles.legendText}>Completed</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.skipped]} />
          <Text style={styles.legendText}>Skipped</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.unknown]} />
          <Text style={styles.legendText}>No data</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  navButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  navButtonPressed: {
    opacity: 0.6,
  },
  navButtonText: {
    fontSize: 24,
    lineHeight: 28,
  },
  monthLabel: {
    fontSize: 18,
    fontWeight: '600',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekdayCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  weekdayText: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
  },
  grid: {
    flexDirection: 'column',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  dayCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayCellSelected: {
    borderColor: '#1F6FEB',
    borderWidth: 2,
  },
  dayCellPressed: {
    opacity: 0.7,
  },
  dayNumber: {
    fontSize: 12,
    fontWeight: '500',
  },
  dayGlyph: {
    fontSize: 14,
    lineHeight: 16,
  },
  glyphCompleted: {
    color: '#1A7F37',
  },
  glyphSkipped: {
    color: '#9A6700',
  },
  glyphUnknown: {
    color: '#8B949E',
  },
  completed: {
    backgroundColor: '#DDF4E4',
    borderColor: '#1A7F37',
  },
  skipped: {
    backgroundColor: '#FFF8C5',
    borderColor: '#9A6700',
  },
  unknown: {
    backgroundColor: '#F6F8FA',
    borderColor: '#D0D7DE',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
  },
  legendText: {
    fontSize: 12,
  },
});