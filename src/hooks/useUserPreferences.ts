import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import type { LanguageCode } from '../i18n';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface QuietHoursConfig {
  enabled: boolean;
  /** Minutes from midnight (0-1439) when quiet hours begin. */
  startMinutes: number;
  /** Minutes from midnight (0-1439) when quiet hours end. */
  endMinutes: number;
}

export interface UserPreferences {
  theme: ThemePreference;
  language: LanguageCode;
  notificationsEnabled: boolean;
  quietHours: QuietHoursConfig;
}

const STORAGE_KEY = '@user_preferences';

export const DEFAULT_QUIET_HOURS: QuietHoursConfig = {
  enabled: false,
  startMinutes: 22 * 60,
  endMinutes: 7 * 60,
};

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  language: 'en',
  notificationsEnabled: true,
  quietHours: DEFAULT_QUIET_HOURS,
};

function normalizeQuietHours(value: unknown): QuietHoursConfig {
  if (!value || typeof value !== 'object') {
    return DEFAULT_QUIET_HOURS;
  }
  const raw = value as Partial<QuietHoursConfig>;
  const clampMinutes = (minutes: unknown, fallback: number): number => {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes)) {
      return fallback;
    }
    const rounded = Math.round(minutes);
    if (rounded < 0 || rounded > 1439) {
      return fallback;
    }
    return rounded;
  };
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_QUIET_HOURS.enabled,
    startMinutes: clampMinutes(raw.startMinutes, DEFAULT_QUIET_HOURS.startMinutes),
    endMinutes: clampMinutes(raw.endMinutes, DEFAULT_QUIET_HOURS.endMinutes),
  };
}

export function useUserPreferences() {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<UserPreferences>;
            setPreferences({
              ...DEFAULT_PREFERENCES,
              ...parsed,
              quietHours: normalizeQuietHours(parsed.quietHours),
            });
          } catch {
            // ignore parse error
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const updatePreference = useCallback(
    async <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
      setPreferences((prev) => {
        const next = { ...prev, [key]: value };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [],
  );

  const updateQuietHours = useCallback(
    async (quietHours: QuietHoursConfig): Promise<QuietHoursConfig> => {
      const normalized = normalizeQuietHours(quietHours);
      let next: UserPreferences = DEFAULT_PREFERENCES;
      setPreferences((prev) => {
        next = { ...prev, quietHours: normalized };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      return normalized;
    },
    [],
  );

  const resetPreferences = useCallback(async () => {
    setPreferences(DEFAULT_PREFERENCES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PREFERENCES));
  }, []);

  return { preferences, updatePreference, updateQuietHours, resetPreferences, loaded };
}
