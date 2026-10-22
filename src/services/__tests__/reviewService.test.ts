import AsyncStorage from '@react-native-async-storage/async-storage';

import { engagementTracker } from '../../utils/engagementTracker';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('engagementTracker.isEligibleForPrompt', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns false when prompted within 90 days', async () => {
    const recent = String(Date.now() - 10 * 24 * 60 * 60 * 1000);

    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'review_last_prompt_ts') return Promise.resolve(recent);
      if (key === 'review_positive_events') return Promise.resolve('5');
      return Promise.resolve(null);
    });

    expect(await engagementTracker.isEligibleForPrompt()).toBe(false);
  });

  it('returns false with fewer than 3 positive events', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'review_positive_events') return Promise.resolve('2');
      return Promise.resolve(null);
    });

    expect(await engagementTracker.isEligibleForPrompt()).toBe(false);
  });

  it('returns true after 90 days and 3+ positive events', async () => {
    const old = String(Date.now() - 91 * 24 * 60 * 60 * 1000);

    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'review_last_prompt_ts') return Promise.resolve(old);
      if (key === 'review_positive_events') return Promise.resolve('5');
      return Promise.resolve(null);
    });

    expect(await engagementTracker.isEligibleForPrompt()).toBe(true);
  });

  it('returns true on first use with 3+ positive events', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'review_positive_events') return Promise.resolve('3');
      return Promise.resolve(null);
    });

    expect(await engagementTracker.isEligibleForPrompt()).toBe(true);
  });
});
