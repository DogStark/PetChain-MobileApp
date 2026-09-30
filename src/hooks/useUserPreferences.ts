import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import type { LanguageCode } from '../i18n';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface UserPreferences {
  theme: ThemePreference;
  language: LanguageCode;
  notificationsEnabled: boolean;
}

const STORAGE_KEY = '@user_preferences';

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  language: 'en',
  notificationsEnabled: true,
};

export function useUserPreferences() {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<UserPreferences>;
            setPreferences({ ...DEFAULT_PREFERENCES, ...parsed });
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

  const resetPreferences = useCallback(async () => {
    setPreferences(DEFAULT_PREFERENCES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PREFERENCES));
  }, []);

  return { preferences, updatePreference, resetPreferences, loaded };
}
