import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';

import type { StreakRecord } from '../services/gamificationService';

/**
 * Optional summary of routine completion days. `unknown` days represent
 * missing data and must never be treated as missed care.
 */
export interface RoutineStreakSummary {
  completed: number;
  skipped: number;
  unknown: number;
}

interface Props {
  streaks: StreakRecord[];
  petNames: Record<string, string>;
  petAvatars?: Record<string, string>;
  loading?: boolean;
  onPress: () => void;
  routineStreak?: RoutineStreakSummary;
}

const MILESTONES = [7, 30, 90];

function nextMilestone(current: number): number {
  return MILESTONES.find((m) => m > current) ?? 90;
}

function routineAccessibilityLabel(routine: RoutineStreakSummary): string {
  const parts = [
    `${routine.completed} completed days`,
    `${routine.skipped} skipped days`,
  ];
  if (routine.unknown > 0) {
    parts.push(`${routine.unknown} days with no data, not counted as missed`);
  }
  return `Routine streak: ${parts.join(', ')}`;
}

export default function StreakDisplay({
  streaks,
  petNames,
  loading,
  onPress,
  routineStreak,
}: Props) {
  if (loading) {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress}>
        <ActivityIndicator color="#4CAF50" />
      </TouchableOpacity>
    );
  }

  if (streaks.length === 0) {
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={
          routineStreak
            ? routineAccessibilityLabel(routineStreak)
            : 'No streaks yet. Start your first streak today!'
        }
      >
        <Text style={styles.empty}>🔥 Start your first streak today!</Text>
        {routineStreak ? (
          <Text style={styles.routineSummary}>
            {routineStreak.completed} completed · {routineStreak.skipped} skipped
            {routineStreak.unknown > 0
              ? ` · ${routineStreak.unknown} no data (not missed)`
              : ''}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  }

  const top = streaks.reduce((a, b) => (a.currentStreak >= b.currentStreak ? a : b));
  const next = nextMilestone(top.currentStreak);
  const progress = Math.min(top.currentStreak / next, 1);

  const streakLabel = `${petNames[top.petId] ?? 'Your pet'}: ${top.currentStreak} day streak, ${top.currentStreak}/${next} days to next badge`;
  const accessibilityLabel = routineStreak
    ? `${streakLabel}. ${routineAccessibilityLabel(routineStreak)}`
    : streakLabel;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.row}>
        <Text style={styles.flame}>🔥</Text>
        <View style={styles.info}>
          <Text style={styles.petName}>{petNames[top.petId] ?? 'Your pet'}</Text>
          <Text style={styles.streak}>{top.currentStreak} day streak</Text>
        </View>
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.milestone}>
        {top.currentStreak}/{next} days to next badge
      </Text>
      {routineStreak ? (
        <Text style={styles.routineSummary}>
          {routineStreak.completed} completed · {routineStreak.skipped} skipped
          {routineStreak.unknown > 0
            ? ` · ${routineStreak.unknown} no data (not missed)`
            : ''}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    marginHorizontal: 16,
    marginVertical: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  flame: { fontSize: 28, marginRight: 10 },
  info: { flex: 1 },
  petName: { fontSize: 14, color: '#666' },
  streak: { fontSize: 20, fontWeight: '700', color: '#4CAF50' },
  barBg: { height: 6, backgroundColor: '#E8F5E9', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: '#4CAF50', borderRadius: 3 },
  milestone: { fontSize: 11, color: '#999', marginTop: 4 },
  routineSummary: { fontSize: 11, color: '#777', marginTop: 4 },
  empty: { fontSize: 14, color: '#4CAF50', textAlign: 'center', paddingVertical: 4 },
});
