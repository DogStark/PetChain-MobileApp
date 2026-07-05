import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  fetchLeaderboard,
  updateLeaderboardPreferences,
  type LeaderboardEntry,
} from '../../backend/services/gamificationService';
import {
  getBadges,
  getStreaks,
  markBadgesDisplayed,
  type Badge,
  type BadgeType,
  type StreakRecord,
} from '../services/gamificationService';

// ─── Badge metadata ───────────────────────────────────────────────────────────

const BADGE_META: Record<BadgeType, { icon: string; name: string; description: string }> = {
  streak_7: { icon: '⚡', name: 'Week Warrior', description: '7-day streak' },
  streak_30: { icon: '🏅', name: 'Monthly Champion', description: '30-day streak' },
  streak_90: { icon: '🦾', name: 'Iron Paw', description: '90-day streak' },
  first_dose: { icon: '🌱', name: 'First Step', description: 'First dose ever logged' },
  recovery: { icon: '💪', name: 'Comeback Kid', description: 'Recovery streak promoted' },
};

const ALL_BADGE_TYPES: BadgeType[] = [
  'first_dose',
  'streak_7',
  'streak_30',
  'streak_90',
  'recovery',
];
const MILESTONES = [7, 30, 90];

function nextMilestone(current: number): number {
  return MILESTONES.find((m) => m > current) ?? 90;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  petNames?: Record<string, string>;
  currentUserId?: string;
  leaderboardOptIn?: boolean;
  leaderboardDisplayName?: string;
}

type Tab = 'Streaks' | 'Badges' | 'Leaderboard';

// ─── Component ────────────────────────────────────────────────────────────────

export default function AchievementsScreen({
  petNames = {},
  currentUserId,
  leaderboardOptIn: initialOptIn = false,
  leaderboardDisplayName: initialDisplayName = '',
}: Props) {
  const [tab, setTab] = useState<Tab>('Streaks');
  const [streaks, setStreaks] = useState<StreakRecord[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [optIn, setOptIn] = useState(initialOptIn);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [loading, setLoading] = useState(false);
  const [leaderboardLastUpdated, setLeaderboardLastUpdated] = useState<string | null>(null);

  const undisplayedCount = badges.filter((b) => !b.displayed).length;

  const load = useCallback(async () => {
    const [s, b] = await Promise.all([getStreaks(), getBadges()]);
    setStreaks(s);
    setBadges(b);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    if (tab === 'Badges') {
      const ids = badges.filter((b) => !b.displayed).map((b) => b.id);
      if (ids.length > 0)
        markBadgesDisplayed(ids)
          .then(load)
          .catch(() => {});
    }
    if (tab === 'Leaderboard' && optIn) {
      setLoading(true);
      fetchLeaderboard()
        .then((entries) => {
          setLeaderboard(entries);
          setLeaderboardLastUpdated(new Date().toLocaleTimeString());
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [tab, optIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOptInToggle = async (value: boolean) => {
    setOptIn(value);
    await updateLeaderboardPreferences({
      leaderboardOptIn: value,
      leaderboardDisplayName: displayName,
    }).catch(() => {});
  };

  const handleDisplayNameSave = async () => {
    await updateLeaderboardPreferences({
      leaderboardOptIn: optIn,
      leaderboardDisplayName: displayName,
    }).catch(() => {});
  };

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <View style={styles.tabBar}>
        {(['Streaks', 'Badges', 'Leaderboard'] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={styles.tabItem} onPress={() => setTab(t)}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t}
              {t === 'Badges' && undisplayedCount > 0 ? ` (${undisplayedCount})` : ''}
            </Text>
            {tab === t && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Streaks Tab */}
      {tab === 'Streaks' && (
        <FlatList
          data={streaks}
          keyExtractor={(item) => `${item.petId}-${item.medicationId}`}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No streaks yet. Log a dose to start!</Text>
          }
          renderItem={({ item }) => {
            const next = nextMilestone(item.currentStreak);
            const progress = Math.min(item.currentStreak / next, 1);
            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{petNames[item.petId] ?? item.petId}</Text>
                <View style={styles.streakRow}>
                  <Text style={styles.streakNum}>🔥 {item.currentStreak}</Text>
                  <Text style={styles.streakSub}>current</Text>
                  <Text style={styles.streakNum}>🏆 {item.longestStreak}</Text>
                  <Text style={styles.streakSub}>best</Text>
                </View>
                {item.recoveryStreakActive && (
                  <Text style={styles.recovery}>Recovery: {item.recoveryCount}/3 days</Text>
                )}
                <View style={styles.barBg}>
                  <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
                </View>
                <Text style={styles.milestone}>
                  {item.currentStreak}/{next} days to next badge
                </Text>
              </View>
            );
          }}
        />
      )}

      {/* Badges Tab */}
      {tab === 'Badges' && (
        <FlatList
          data={ALL_BADGE_TYPES}
          keyExtractor={(t) => t}
          contentContainerStyle={styles.list}
          renderItem={({ item: type }) => {
            const earned = badges.find((b) => b.badgeType === type);
            const meta = BADGE_META[type];
            return (
              <View style={[styles.card, !earned && styles.cardLocked]}>
                <Text style={styles.badgeIcon}>{earned ? meta.icon : '🔒'}</Text>
                <View style={styles.badgeInfo}>
                  <Text style={[styles.badgeName, !earned && styles.textLocked]}>{meta.name}</Text>
                  <Text style={styles.badgeDesc}>{meta.description}</Text>
                  {earned && (
                    <Text style={styles.badgeDate}>
                      Earned {new Date(earned.earnedAt).toLocaleDateString()} ·{' '}
                      {petNames[earned.petId] ?? earned.petId}
                    </Text>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Leaderboard Tab */}
      {tab === 'Leaderboard' && (
        <ScrollView contentContainerStyle={styles.list}>
          <View style={styles.card}>
            <View style={styles.optInRow}>
              <Text style={styles.optInLabel}>Join community leaderboard</Text>
              <Switch
                value={optIn}
                onValueChange={handleOptInToggle}
                trackColor={{ true: '#4CAF50' }}
              />
            </View>
            {optIn && (
              <View style={styles.displayNameRow}>
                <TextInput
                  style={styles.displayNameInput}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Display name (optional)"
                  onBlur={handleDisplayNameSave}
                  returnKeyType="done"
                  onSubmitEditing={handleDisplayNameSave}
                />
              </View>
            )}
          </View>

          {!optIn && (
            <Text style={styles.empty}>Opt in above to see the community leaderboard.</Text>
          )}

          {optIn && loading && <ActivityIndicator color="#4CAF50" style={{ marginTop: 20 }} />}

          {optIn &&
            !loading &&
            leaderboard.map((entry) => (
              <View
                key={entry.userId}
                style={[styles.card, entry.userId === currentUserId && styles.cardHighlight]}
              >
                <Text style={styles.rank}>#{entry.rank}</Text>
                <View style={styles.leaderInfo}>
                  <Text style={styles.leaderName}>{entry.displayName}</Text>
                  <Text style={styles.leaderStats}>
                    🔥 {entry.currentStreak} days · 🏅 {entry.badgeCount} badges
                  </Text>
                </View>
              </View>
            ))}

          {optIn && !loading && leaderboardLastUpdated && (
            <Text style={styles.lastUpdated}>Last updated: {leaderboardLastUpdated}</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', elevation: 2 },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel: { fontSize: 14, color: '#999' },
  tabLabelActive: { color: '#4CAF50', fontWeight: '600' },
  tabUnderline: {
    height: 2,
    backgroundColor: '#4CAF50',
    width: '60%',
    marginTop: 4,
    borderRadius: 1,
  },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  cardLocked: { opacity: 0.5 },
  cardHighlight: { borderWidth: 2, borderColor: '#4CAF50' },
  cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 8 },
  streakRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 8 },
  streakNum: { fontSize: 22, fontWeight: '700', color: '#4CAF50' },
  streakSub: { fontSize: 12, color: '#999', marginRight: 12 },
  recovery: { fontSize: 12, color: '#FF9800', marginBottom: 6 },
  barBg: { height: 6, backgroundColor: '#E8F5E9', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: '#4CAF50', borderRadius: 3 },
  milestone: { fontSize: 11, color: '#999', marginTop: 4 },
  badgeIcon: { fontSize: 32, marginBottom: 6 },
  badgeInfo: { flex: 1 },
  badgeName: { fontSize: 15, fontWeight: '600' },
  textLocked: { color: '#999' },
  badgeDesc: { fontSize: 12, color: '#666', marginTop: 2 },
  badgeDate: { fontSize: 11, color: '#4CAF50', marginTop: 4 },
  optInRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  optInLabel: { fontSize: 14, fontWeight: '500' },
  displayNameRow: { marginTop: 10 },
  displayNameInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  rank: { fontSize: 18, fontWeight: '700', color: '#4CAF50', marginRight: 12 },
  leaderInfo: { flex: 1 },
  leaderName: { fontSize: 14, fontWeight: '600' },
  leaderStats: { fontSize: 12, color: '#666', marginTop: 2 },
  lastUpdated: { fontSize: 11, color: '#999', textAlign: 'center', marginTop: 8 },
  empty: { textAlign: 'center', color: '#999', marginTop: 24, fontSize: 14 },
});
