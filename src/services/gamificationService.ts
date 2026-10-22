import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { v4 as uuidv4 } from 'uuid';

import type { DoseLog } from './medicationService';
export type { DoseLog };

// ─── Types ────────────────────────────────────────────────────────────────────

export type BadgeType = 'streak_7' | 'streak_30' | 'streak_90' | 'first_dose' | 'recovery';

export interface StreakRecord {
  petId: string;
  medicationId: string;
  currentStreak: number;
  longestStreak: number;
  lastOnTimeDayISO: string | null;
  recoveryStreakActive: boolean;
  recoveryCount: number;
}

export interface Badge {
  id: string;
  petId: string;
  medicationId: string;
  badgeType: BadgeType;
  earnedAt: string;
  displayed: boolean;
}

const STREAKS_KEY = '@streaks';
const BADGES_KEY = '@badges';
const GRACE_PERIOD_MS = 2 * 60 * 60 * 1000; // ±2 hours

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function loadStreaks(): Promise<StreakRecord[]> {
  const raw = await AsyncStorage.getItem(STREAKS_KEY);
  return raw ? (JSON.parse(raw) as StreakRecord[]) : [];
}

async function saveStreaks(records: StreakRecord[]): Promise<void> {
  await AsyncStorage.setItem(STREAKS_KEY, JSON.stringify(records));
}

async function loadBadges(): Promise<Badge[]> {
  const raw = await AsyncStorage.getItem(BADGES_KEY);
  return raw ? (JSON.parse(raw) as Badge[]) : [];
}

async function saveBadges(badges: Badge[]): Promise<void> {
  await AsyncStorage.setItem(BADGES_KEY, JSON.stringify(badges));
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function toDateISO(date: Date): string {
  return date.toLocaleDateString('sv'); // YYYY-MM-DD in local timezone
}

/** Determine if a dose log is on-time relative to its scheduled time. */
export function calculateStreakForDate(
  petId: string,
  medicationId: string,
  date: Date,
  logs: DoseLog[],
  gracePeriodMs = GRACE_PERIOD_MS,
): boolean {
  const dayISO = toDateISO(date);
  const dayLogs = logs.filter(
    (l) =>
      l.medicationId === medicationId && !l.skipped && toDateISO(new Date(l.takenAt)) === dayISO,
  );
  if (dayLogs.length === 0) return false;
  return dayLogs.some((l) => {
    if (!l.scheduledFor) return true;
    return (
      Math.abs(new Date(l.takenAt).getTime() - new Date(l.scheduledFor).getTime()) <= gracePeriodMs
    );
  });
}

const BADGE_MILESTONES: Array<{ streak: number; type: BadgeType }> = [
  { streak: 7, type: 'streak_7' },
  { streak: 30, type: 'streak_30' },
  { streak: 90, type: 'streak_90' },
];

async function awardBadge(
  petId: string,
  medicationId: string,
  badgeType: BadgeType,
  badges: Badge[],
): Promise<Badge | null> {
  const already = badges.some((b) => b.petId === petId && b.badgeType === badgeType);
  if (already) return null;
  const badge: Badge = {
    id: uuidv4(),
    petId,
    medicationId,
    badgeType,
    earnedAt: new Date().toISOString(),
    displayed: false,
  };
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🏆 Badge Earned!',
      body: `You earned the "${badgeType.replace('_', ' ')}" badge!`,
      sound: 'default',
      data: { type: 'gamification', badgeType, petId },
    },
    trigger: null,
  });
  return badge;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function updateStreak(
  petId: string,
  medicationId: string,
  doseLog: DoseLog,
): Promise<{ streak: StreakRecord; newBadges: Badge[] }> {
  const [streaks, badges] = await Promise.all([loadStreaks(), loadBadges()]);

  const idx = streaks.findIndex((s) => s.petId === petId && s.medicationId === medicationId);
  const existing: StreakRecord =
    idx >= 0
      ? streaks[idx]
      : {
          petId,
          medicationId,
          currentStreak: 0,
          longestStreak: 0,
          lastOnTimeDayISO: null,
          recoveryStreakActive: false,
          recoveryCount: 0,
        };

  const todayISO = toDateISO(new Date(doseLog.takenAt));
  const isOnTime =
    !doseLog.skipped &&
    (!doseLog.scheduledFor ||
      Math.abs(new Date(doseLog.takenAt).getTime() - new Date(doseLog.scheduledFor).getTime()) <=
        GRACE_PERIOD_MS);

  const newBadges: Badge[] = [];

  // Already counted today
  if (existing.lastOnTimeDayISO === todayISO) {
    return { streak: existing, newBadges };
  }

  const updated = { ...existing };

  if (isOnTime) {
    const yesterday = new Date(doseLog.takenAt);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = toDateISO(yesterday);
    const consecutive = existing.lastOnTimeDayISO === yesterdayISO;

    if (updated.recoveryStreakActive) {
      updated.recoveryCount += 1;
      if (updated.recoveryCount >= 3) {
        updated.currentStreak = updated.recoveryCount;
        updated.recoveryStreakActive = false;
        updated.recoveryCount = 0;
        const b = await awardBadge(petId, medicationId, 'recovery', badges);
        if (b) newBadges.push(b);
      }
    } else if (consecutive || existing.lastOnTimeDayISO === null) {
      updated.currentStreak += 1;
    } else {
      // Gap — reset
      updated.currentStreak = 1;
    }

    updated.lastOnTimeDayISO = todayISO;
    updated.longestStreak = Math.max(updated.longestStreak, updated.currentStreak);

    // First dose badge
    if (existing.lastOnTimeDayISO === null) {
      const b = await awardBadge(petId, medicationId, 'first_dose', badges);
      if (b) newBadges.push(b);
    }

    // Milestone badges
    for (const { streak, type } of BADGE_MILESTONES) {
      if (updated.currentStreak >= streak) {
        const b = await awardBadge(petId, medicationId, type, [...badges, ...newBadges]);
        if (b) newBadges.push(b);
      }
    }
  }

  if (idx >= 0) streaks[idx] = updated;
  else streaks.push(updated);

  const allBadges = [...badges, ...newBadges];
  await Promise.all([saveStreaks(streaks), saveBadges(allBadges)]);

  return { streak: updated, newBadges };
}

export async function resetStreak(petId: string, medicationId: string): Promise<void> {
  const streaks = await loadStreaks();
  const idx = streaks.findIndex((s) => s.petId === petId && s.medicationId === medicationId);
  if (idx < 0) return;
  streaks[idx] = {
    ...streaks[idx],
    currentStreak: 0,
    recoveryStreakActive: true,
    recoveryCount: 0,
  };
  await saveStreaks(streaks);
}

export async function getStreaks(petId?: string): Promise<StreakRecord[]> {
  const streaks = await loadStreaks();
  return petId ? streaks.filter((s) => s.petId === petId) : streaks;
}

export async function getBadges(petId?: string): Promise<Badge[]> {
  const badges = await loadBadges();
  return petId ? badges.filter((b) => b.petId === petId) : badges;
}

export async function markBadgesDisplayed(badgeIds: string[]): Promise<void> {
  const badges = await loadBadges();
  const updated = badges.map((b) => (badgeIds.includes(b.id) ? { ...b, displayed: true } : b));
  await saveBadges(updated);
}

export async function initializeGamification(): Promise<void> {
  const raw = await AsyncStorage.getItem(STREAKS_KEY);
  if (raw === null) await AsyncStorage.setItem(STREAKS_KEY, '[]');
  const rawB = await AsyncStorage.getItem(BADGES_KEY);
  if (rawB === null) await AsyncStorage.setItem(BADGES_KEY, '[]');
}
