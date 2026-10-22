import {
  EmergencyProfileService,
  EmergencyProfile,
  FreshnessStatus,
  FRESHNESS_TTL_MS,
  CLOCK_SKEW_TOLERANCE_MS,
} from '../emergencyProfileService';

/**
 * Tests for the offline emergency-profile freshness policy (issue #1042).
 *
 * Covers:
 *  - expiry of cached emergency data
 *  - clock skew tolerance
 *  - offline scan (no network) using cached data
 *  - revocation reconciliation
 */

describe('EmergencyProfileService freshness policy', () => {
  const baseProfile: EmergencyProfile = {
    id: 'profile-1',
    bloodType: 'O+',
    allergies: ['penicillin'],
    medications: ['insulin'],
    conditions: ['diabetes'],
    emergencyContacts: [{ name: 'Jane', phone: '+15551234567' }],
    lastVerifiedAt: 1_000_000,
    revoked: false,
  };

  let service: EmergencyProfileService;

  beforeEach(() => {
    service = new EmergencyProfileService();
  });

  describe('expiry', () => {
    it('reports fresh data within the TTL window', () => {
      const now = baseProfile.lastVerifiedAt + FRESHNESS_TTL_MS - 1;
      expect(service.getFreshness(baseProfile, now)).toBe<FreshnessStatus>('fresh');
    });

    it('reports expired data past the TTL window', () => {
      const now = baseProfile.lastVerifiedAt + FRESHNESS_TTL_MS + 1;
      expect(service.getFreshness(baseProfile, now)).toBe<FreshnessStatus>('expired');
    });

    it('marks expired data and offers a minimal safe fallback', () => {
      const now = baseProfile.lastVerifiedAt + FRESHNESS_TTL_MS + 1;
      const view = service.getEmergencyView(baseProfile, now);
      expect(view.freshness).toBe<FreshnessStatus>('expired');
      expect(view.isExpired).toBe(true);
      expect(view.fallback).not.toBeNull();
      expect(view.fallback?.bloodType).toBe(baseProfile.bloodType);
      expect(view.fallback?.emergencyContacts).toEqual(baseProfile.emergencyContacts);
    });
  });

  describe('clock skew', () => {
    it('tolerates small negative clock skew without marking expired', () => {
      const now = baseProfile.lastVerifiedAt + FRESHNESS_TTL_MS + CLOCK_SKEW_TOLERANCE_MS - 1;
      expect(service.getFreshness(baseProfile, now)).toBe<FreshnessStatus>('fresh');
    });

    it('treats a future lastVerifiedAt as fresh (device clock behind)', () => {
      const now = baseProfile.lastVerifiedAt - CLOCK_SKEW_TOLERANCE_MS;
      expect(service.getFreshness(baseProfile, now)).toBe<FreshnessStatus>('fresh');
    });

    it('marks data expired once skew tolerance is exceeded', () => {
      const now = baseProfile.lastVerifiedAt + FRESHNESS_TTL_MS + CLOCK_SKEW_TOLERANCE_MS + 1;
      expect(service.getFreshness(baseProfile, now)).toBe<FreshnessStatus>('expired');
    });
  });

  describe('offline scan', () => {
    it('serves cached data when offline', async () => {
      service.cacheProfile(baseProfile);
      const result = await service.scan({ online: false, now: baseProfile.lastVerifiedAt + 1000 });
      expect(result.source).toBe('cache');
      expect(result.profile?.id).toBe(baseProfile.id);
      expect(result.freshness).toBe<FreshnessStatus>('fresh');
    });

    it('serves cached data with expired marker when offline and stale', async () => {
      service.cacheProfile(baseProfile);
      const now = baseProfile.lastVerifiedAt + FRESHNESS_TTL_MS + 1;
      const result = await service.scan({ online: false, now });
      expect(result.source).toBe('cache');
      expect(result.freshness).toBe<FreshnessStatus>('expired');
      expect(result.fallback).not.toBeNull();
    });

    it('returns empty result when offline with no cache', async () => {
      const result = await service.scan({ online: false, now: Date.now() });
      expect(result.source).toBe('none');
      expect(result.profile).toBeNull();
    });
  });

  describe('revocation reconciliation', () => {
    it('drops revoked profiles during refresh', async () => {
      service.cacheProfile(baseProfile);
      const revoked: EmergencyProfile = { ...baseProfile, revoked: true, lastVerifiedAt: baseProfile.lastVerifiedAt + 5000 };
      const result = await service.refresh(revoked, baseProfile.lastVerifiedAt + 6000);
      expect(result.profile).toBeNull();
      expect(service.getCachedProfile()).toBeNull();
    });

    it('does not replace newer local edits with older remote data', async () => {
      const localEdit: EmergencyProfile = {
        ...baseProfile,
        allergies: ['penicillin', 'latex'],
        lastVerifiedAt: baseProfile.lastVerifiedAt + 10_000,
      };
      service.cacheProfile(localEdit);

      const olderRemote: EmergencyProfile = {
        ...baseProfile,
        allergies: ['penicillin'],
        lastVerifiedAt: baseProfile.lastVerifiedAt + 1000,
      };

      const result = await service.refresh(olderRemote, baseProfile.lastVerifiedAt + 11_000);
      expect(result.profile?.allergies).toEqual(['penicillin', 'latex']);
      expect(service.getCachedProfile()?.allergies).toEqual(['penicillin', 'latex']);
    });

    it('applies newer remote data atomically', async () => {
      service.cacheProfile(baseProfile);
      const newerRemote: EmergencyProfile = {
        ...baseProfile,
        bloodType: 'A-',
        lastVerifiedAt: baseProfile.lastVerifiedAt + 20_000,
      };
      const result = await service.refresh(newerRemote, baseProfile.lastVerifiedAt + 21_000);
      expect(result.profile?.bloodType).toBe('A-');
      expect(service.getCachedProfile()?.bloodType).toBe('A-');
    });
  });
});
