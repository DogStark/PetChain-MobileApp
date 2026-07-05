import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';

import type { StreakRecord } from '../services/gamificationService';

interface Props {
  streaks: StreakRecord[];
  petNames: Record<string, string>;
  petAvatars?: Record<string, string>;
  loading?: boolean;
  onPress: () => void;
}

const MILESTONES = [7, 30, 90];

function nextMilestone(current: number): number {
  return MILESTONES.find((m) => m > current) ?? 90;
}

export default function StreakDisplay({ streaks, petNames, loading, onPress }: Props) {
  if (loading) {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress}>
        <ActivityIndicator color="#4CAF50" />
      </TouchableOpacity>
    );
  }

  if (streaks.length === 0) {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress}>
        <Text style={styles.empty}>🔥 Start your first streak today!</Text>
      </TouchableOpacity>
    );
  }

  const top = streaks.reduce((a, b) => (a.currentStreak >= b.currentStreak ? a : b));
  const next = nextMilestone(top.currentStreak);
  const progress = Math.min(top.currentStreak / next, 1);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} accessibilityRole="button">
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
  empty: { fontSize: 14, color: '#4CAF50', textAlign: 'center', paddingVertical: 4 },
});
