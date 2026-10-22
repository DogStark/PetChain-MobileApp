import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { darkTheme, lightTheme } from '../theme/colors';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = '@theme_mode';

export interface ThemeState {
  theme: ResolvedTheme;
  mode: ThemeMode;
  isDark: boolean;
  colors: typeof lightTheme;
  setMode: (mode: ThemeMode) => Promise<void>;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function resolveThemeMode(
  mode: ThemeMode,
  systemScheme: 'light' | 'dark' | null,
): ResolvedTheme {
  if (mode === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
  return mode;
}

export const ThemeProvider: React.FC<React.PropsWithChildren<unknown>> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setModeState(stored);
        }
      })
      .catch(() => {});
  }, []);

  const setMode = useCallback(async (newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, newMode);
    } catch {
      // Theme changes should still apply even if preference persistence fails.
    }
  }, []);

  const theme = resolveThemeMode(mode, systemScheme === 'dark' ? 'dark' : 'light');
  const colors = theme === 'dark' ? darkTheme : lightTheme;

  const value = useMemo(
    () => ({
      theme,
      mode,
      isDark: theme === 'dark',
      colors,
      setMode,
    }),
    [colors, mode, setMode, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
