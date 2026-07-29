import React from 'react';
import TestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUserPreferences } from '../useUserPreferences';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn(),
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

function PreferencesConsumer() {
  const result = useUserPreferences();
  return (
    <React.Fragment>
      <view testID="theme">{result.preferences.theme}</view>
      <view testID="language">{result.preferences.language}</view>
      <view testID="notifications">{String(result.preferences.notificationsEnabled)}</view>
      <view testID="updateTheme" onPress={() => result.updatePreference('theme', 'dark')}>
        update
      </view>
      <view testID="reset" onPress={result.resetPreferences}>
        reset
      </view>
    </React.Fragment>
  );
}

describe('useUserPreferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
  });

  it('returns default preferences when nothing is stored', async () => {
    let root: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => {
      root = TestRenderer.create(<PreferencesConsumer />);
    });

    expect(root!.root.findByProps({ testID: 'theme' }).props.children).toBe('system');
    expect(root!.root.findByProps({ testID: 'language' }).props.children).toBe('en');
    expect(root!.root.findByProps({ testID: 'notifications' }).props.children).toBe('true');
  });

  it('loads persisted preferences from storage', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({ theme: 'dark', language: 'es', notificationsEnabled: false }),
    );

    let root: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => {
      root = TestRenderer.create(<PreferencesConsumer />);
    });

    expect(root!.root.findByProps({ testID: 'theme' }).props.children).toBe('dark');
    expect(root!.root.findByProps({ testID: 'language' }).props.children).toBe('es');
    expect(root!.root.findByProps({ testID: 'notifications' }).props.children).toBe('false');
  });

  it('updates a single preference and persists it', async () => {
    let root: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => {
      root = TestRenderer.create(<PreferencesConsumer />);
    });

    await TestRenderer.act(async () => {
      root!.root.findByProps({ testID: 'updateTheme' }).props.onPress();
    });

    expect(root!.root.findByProps({ testID: 'theme' }).props.children).toBe('dark');
    expect(mockSetItem).toHaveBeenCalledWith(
      '@user_preferences',
      expect.stringContaining('"theme":"dark"'),
    );
  });

  it('resets preferences to defaults', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({ theme: 'dark', language: 'es', notificationsEnabled: false }),
    );

    let root: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => {
      root = TestRenderer.create(<PreferencesConsumer />);
    });

    await TestRenderer.act(async () => {
      root!.root.findByProps({ testID: 'reset' }).props.onPress();
    });

    expect(root!.root.findByProps({ testID: 'theme' }).props.children).toBe('system');
    expect(root!.root.findByProps({ testID: 'language' }).props.children).toBe('en');
    expect(root!.root.findByProps({ testID: 'notifications' }).props.children).toBe('true');
    expect(mockSetItem).toHaveBeenCalledWith(
      '@user_preferences',
      expect.stringContaining('"theme":"system"'),
    );
  });
});
