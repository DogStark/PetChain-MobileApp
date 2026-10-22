import apiClient from '../services/apiClient';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  currentStreak: number;
  badgeCount: number;
  isCurrentUser?: boolean;
}

export interface GamificationPreferences {
  leaderboardOptIn: boolean;
  leaderboardDisplayName?: string;
}

export interface StreakSyncPayload {
  petId: string;
  medicationId: string;
  currentStreak: number;
  longestStreak: number;
  lastOnTimeDayISO: string | null;
}

export async function submitStreakUpdate(payload: StreakSyncPayload): Promise<void> {
  await apiClient.post('/api/gamification/streak', payload);
}

export async function fetchLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const res = await apiClient.get<{ entries: LeaderboardEntry[] }>(
    `/api/gamification/leaderboard?limit=${limit}`,
  );
  return res.data.entries;
}

export async function updateLeaderboardPreferences(prefs: GamificationPreferences): Promise<void> {
  await apiClient.put('/api/gamification/preferences', prefs);
}
