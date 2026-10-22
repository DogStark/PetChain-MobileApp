import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DoseLog } from '../medicationService';

import {
  calculateStreakForDate,
  updateStreak,
  getStreaks,
  getBadges,
  markBadgesDisplayed,
  resetStreak,
} from '../gamificationService';

type LocalDoseLog = DoseLog;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id'),
}));

const mockStorage: Record<string, string> = {};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);

  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) =>
    Promise.resolve(mockStorage[key] ?? null),
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => {
    mockStorage[key] = value;
    return Promise.resolve();
  });
});

// ─── calculateStreakForDate ────────────────────────────────────────────────────

describe('calculateStreakForDate', () => {
  const petId = 'pet1';
  const medicationId = 'med1';
  const date = new Date('2025-06-15T10:00:00');

  function makeLog(takenAt: string, scheduledFor?: string, skipped = false): LocalDoseLog {
    return { id: 'l1', medicationId, takenAt, scheduledFor, skipped };
  }

  it('returns true when dose is on time (within grace period)', () => {
    const log = makeLog('2025-06-15T10:30:00', '2025-06-15T10:00:00');
    expect(calculateStreakForDate(petId, medicationId, date, [log])).toBe(true);
  });

  it('returns false when dose is late (outside grace period)', () => {
    const log = makeLog('2025-06-15T13:00:00', '2025-06-15T10:00:00');
    expect(calculateStreakForDate(petId, medicationId, date, [log])).toBe(false);
  });

  it('returns false when dose is missed (no log for that day)', () => {
    expect(calculateStreakForDate(petId, medicationId, date, [])).toBe(false);
  });

  it('returns false when dose is skipped', () => {
    const log = makeLog('2025-06-15T10:00:00', '2025-06-15T10:00:00', true);
    expect(calculateStreakForDate(petId, medicationId, date, [log])).toBe(false);
  });

  it('returns true when no scheduledFor (unscheduled dose counts)', () => {
    const log = makeLog('2025-06-15T10:00:00');
    expect(calculateStreakForDate(petId, medicationId, date, [log])).toBe(true);
  });

  it('boundary: exactly at grace period edge is on time', () => {
    const log = makeLog('2025-06-15T12:00:00', '2025-06-15T10:00:00');
    expect(calculateStreakForDate(petId, medicationId, date, [log])).toBe(true);
  });

  it('boundary: 1ms over grace period is late', () => {
    const log = makeLog('2025-06-15T12:00:00.001', '2025-06-15T10:00:00');
    expect(calculateStreakForDate(petId, medicationId, date, [log])).toBe(false);
  });
});

// ─── updateStreak ─────────────────────────────────────────────────────────────

describe('updateStreak', () => {
  const petId = 'pet1';
  const medicationId = 'med1';

  function onTimeLog(takenAt: string): LocalDoseLog {
    return { id: 'l1', medicationId, takenAt, scheduledFor: takenAt };
  }

  it('increments streak on first on-time dose', async () => {
    const { streak, newBadges } = await updateStreak(
      petId,
      medicationId,
      onTimeLog('2025-06-01T10:00:00'),
    );
    expect(streak.currentStreak).toBe(1);
    expect(streak.longestStreak).toBe(1);
    expect(newBadges.some((b) => b.badgeType === 'first_dose')).toBe(true);
  });

  it('increments streak on consecutive days', async () => {
    await updateStreak(petId, medicationId, onTimeLog('2025-06-01T10:00:00'));
    const { streak } = await updateStreak(petId, medicationId, onTimeLog('2025-06-02T10:00:00'));
    expect(streak.currentStreak).toBe(2);
  });

  it('does not double-count same day', async () => {
    await updateStreak(petId, medicationId, onTimeLog('2025-06-01T10:00:00'));
    const { streak } = await updateStreak(petId, medicationId, onTimeLog('2025-06-01T14:00:00'));
    expect(streak.currentStreak).toBe(1);
  });

  it('resets streak on missed day (gap)', async () => {
    await updateStreak(petId, medicationId, onTimeLog('2025-06-01T10:00:00'));
    // Skip June 2, log June 3
    const { streak } = await updateStreak(petId, medicationId, onTimeLog('2025-06-03T10:00:00'));
    expect(streak.currentStreak).toBe(1);
  });

  it('preserves longestStreak after reset', async () => {
    await updateStreak(petId, medicationId, onTimeLog('2025-06-01T10:00:00'));
    await updateStreak(petId, medicationId, onTimeLog('2025-06-02T10:00:00'));
    await updateStreak(petId, medicationId, onTimeLog('2025-06-03T10:00:00'));
    // Gap
    const { streak } = await updateStreak(petId, medicationId, onTimeLog('2025-06-10T10:00:00'));
    expect(streak.longestStreak).toBe(3);
    expect(streak.currentStreak).toBe(1);
  });

  it('awards streak_7 badge at 7-day streak', async () => {
    for (let i = 1; i <= 7; i++) {
      const { newBadges } = await updateStreak(
        petId,
        medicationId,
        onTimeLog(`2025-06-${String(i).padStart(2, '0')}T10:00:00`),
      );
      if (i === 7) {
        expect(newBadges.some((b) => b.badgeType === 'streak_7')).toBe(true);
      }
    }
  });

  it('does not award duplicate badges', async () => {
    for (let i = 1; i <= 8; i++) {
      await updateStreak(
        petId,
        medicationId,
        onTimeLog(`2025-06-${String(i).padStart(2, '0')}T10:00:00`),
      );
    }
    const badges = await getBadges(petId);
    const streak7Badges = badges.filter((b) => b.badgeType === 'streak_7');
    expect(streak7Badges).toHaveLength(1);
  });
});

// ─── Recovery mechanic ────────────────────────────────────────────────────────

describe('recovery streak', () => {
  const petId = 'pet2';
  const medicationId = 'med2';

  function onTimeLog(takenAt: string): LocalDoseLog {
    return { id: 'l1', medicationId, takenAt, scheduledFor: takenAt };
  }

  it('activates recovery after explicit reset', async () => {
    await updateStreak(petId, medicationId, onTimeLog('2025-07-01T10:00:00'));
    await resetStreak(petId, medicationId);
    const [s] = await getStreaks(petId);
    expect(s.currentStreak).toBe(0);
    expect(s.recoveryStreakActive).toBe(true);
  });

  it('promotes recovery to current streak after 3 consecutive days', async () => {
    await updateStreak(petId, medicationId, onTimeLog('2025-07-01T10:00:00'));
    await resetStreak(petId, medicationId);

    await updateStreak(petId, medicationId, onTimeLog('2025-07-02T10:00:00'));
    await updateStreak(petId, medicationId, onTimeLog('2025-07-03T10:00:00'));
    const { streak, newBadges } = await updateStreak(
      petId,
      medicationId,
      onTimeLog('2025-07-04T10:00:00'),
    );

    expect(streak.recoveryStreakActive).toBe(false);
    expect(streak.currentStreak).toBe(3);
    expect(newBadges.some((b) => b.badgeType === 'recovery')).toBe(true);
  });
});

// ─── getStreaks / getBadges / markBadgesDisplayed ─────────────────────────────

describe('getStreaks and getBadges', () => {
  it('returns empty arrays on first launch', async () => {
    expect(await getStreaks()).toEqual([]);
    expect(await getBadges()).toEqual([]);
  });

  it('filters by petId', async () => {
    await updateStreak('petA', 'med1', {
      id: 'l1',
      medicationId: 'med1',
      takenAt: '2025-08-01T10:00:00',
      scheduledFor: '2025-08-01T10:00:00',
    });
    await updateStreak('petB', 'med1', {
      id: 'l2',
      medicationId: 'med1',
      takenAt: '2025-08-01T10:00:00',
      scheduledFor: '2025-08-01T10:00:00',
    });
    const streaks = await getStreaks('petA');
    expect(streaks.every((s) => s.petId === 'petA')).toBe(true);
  });
});

describe('markBadgesDisplayed', () => {
  it('marks specified badges as displayed', async () => {
    await updateStreak('petC', 'med1', {
      id: 'l1',
      medicationId: 'med1',
      takenAt: '2025-09-01T10:00:00',
      scheduledFor: '2025-09-01T10:00:00',
    });
    const before = await getBadges('petC');
    const ids = before.map((b) => b.id);
    await markBadgesDisplayed(ids);
    const after = await getBadges('petC');
    expect(after.every((b) => b.displayed)).toBe(true);
  });
});
