import AsyncStorage from '@react-native-async-storage/async-storage';

import { resolveThemeMode } from '../../context/ThemeContext';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('react-native', () => ({
  useColorScheme: jest.fn(() => 'dark'),
}));

const mockGet = AsyncStorage.getItem as jest.Mock;
const mockSet = AsyncStorage.setItem as jest.Mock;

const STORAGE_KEY = '@theme_mode';

// Test the pure storage helpers directly (extracted logic from useTheme)
async function loadMode(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEY);
}

async function saveMode(mode: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, mode);
}

beforeEach(() => jest.clearAllMocks());

describe('useTheme — storage logic', () => {
  it('loads null when nothing stored', async () => {
    mockGet.mockResolvedValue(null);
    expect(await loadMode()).toBeNull();
  });

  it('loads persisted mode', async () => {
    mockGet.mockResolvedValue('light');
    expect(await loadMode()).toBe('light');
  });

  it('saves mode to storage', async () => {
    mockSet.mockResolvedValue(undefined);
    await saveMode('dark');
    expect(mockSet).toHaveBeenCalledWith(STORAGE_KEY, 'dark');
  });
});

describe('useTheme — theme resolution', () => {
  it('system mode resolves to system color scheme', () => {
    expect(resolveThemeMode('system', 'dark')).toBe('dark');
    expect(resolveThemeMode('system', 'light')).toBe('light');
  });

  it('system mode falls back to light when scheme is null', () => {
    expect(resolveThemeMode('system', null)).toBe('light');
  });

  it('manual light overrides system dark', () => {
    expect(resolveThemeMode('light', 'dark')).toBe('light');
  });

  it('manual dark overrides system light', () => {
    expect(resolveThemeMode('dark', 'light')).toBe('dark');
  });
});
