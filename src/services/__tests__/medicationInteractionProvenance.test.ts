import {
  INTERACTION_DATA_PROVENANCE,
  INTERACTION_DATA_STALE_AFTER_DAYS,
  INTERACTION_DATA_UNAVAILABLE_AFTER_DAYS,
  assessInteractionDataFreshness,
  presentInteractionWarning,
} from '../medicationService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const published = new Date(INTERACTION_DATA_PROVENANCE.publishedAt).getTime();
const daysAfterPublish = (n: number) => new Date(published + n * 24 * 60 * 60 * 1000);

describe('medication interaction data provenance & freshness (#959)', () => {
  // Characterises the current/target behaviour before the UI consumes it.
  it('exposes source, version and publish date as provenance', () => {
    expect(INTERACTION_DATA_PROVENANCE.source).toEqual(expect.any(String));
    expect(INTERACTION_DATA_PROVENANCE.version).toEqual(expect.any(String));
    expect(() => new Date(INTERACTION_DATA_PROVENANCE.publishedAt).toISOString()).not.toThrow();
  });

  it('treats recent data as fresh and authoritative', () => {
    const status = assessInteractionDataFreshness(daysAfterPublish(10));
    expect(status.freshness).toBe('fresh');
    expect(status.authoritative).toBe(true);
    expect(status.unavailable).toBe(false);
    expect(status.ageDays).toBe(10);
    expect(status.disclaimer).toMatch(/veterinar/i);
  });

  it('flags data past the stale threshold as non-authoritative but still shown', () => {
    const status = assessInteractionDataFreshness(
      daysAfterPublish(INTERACTION_DATA_STALE_AFTER_DAYS + 1),
    );
    expect(status.freshness).toBe('stale');
    expect(status.authoritative).toBe(false);
    expect(status.unavailable).toBe(false);
    expect(status.disclaimer).toMatch(/out of date|old/i);
  });

  it('marks data past the unavailable threshold as expired and withheld', () => {
    const status = assessInteractionDataFreshness(
      daysAfterPublish(INTERACTION_DATA_UNAVAILABLE_AFTER_DAYS + 1),
    );
    expect(status.freshness).toBe('expired');
    expect(status.authoritative).toBe(false);
    expect(status.unavailable).toBe(true);
    expect(status.updatePolicy).toMatch(/withheld|stale/i);
  });

  it('handles a malformed publish date as expired rather than crashing', () => {
    const status = assessInteractionDataFreshness(new Date(), {
      ...INTERACTION_DATA_PROVENANCE,
      publishedAt: 'not-a-date',
    });
    expect(status.unavailable).toBe(true);
    expect(status.ageDays).toBe(Number.POSITIVE_INFINITY);
  });

  describe('presentInteractionWarning', () => {
    it('attaches an attribution line and keeps the message when fresh', () => {
      const p = presentInteractionWarning('Do not combine drug A and drug B.', daysAfterPublish(5));
      expect(p.message).toContain('drug A');
      expect(p.attribution).toContain(INTERACTION_DATA_PROVENANCE.source);
      expect(p.attribution).toContain('5 days old');
      expect(p.authoritative).toBe(true);
      expect(p.suppressed).toBe(false);
    });

    it('suppresses the warning body once the data is expired', () => {
      const p = presentInteractionWarning(
        'Do not combine drug A and drug B.',
        daysAfterPublish(INTERACTION_DATA_UNAVAILABLE_AFTER_DAYS + 5),
      );
      expect(p.message).toBe('');
      expect(p.suppressed).toBe(true);
      expect(p.disclaimer).toMatch(/unavailable/i);
    });
  });
});
