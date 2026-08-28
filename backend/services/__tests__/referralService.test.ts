import { UserRole } from '../../models/UserRole';
import { store, type StoredUser } from '../../server/store';
import referralService from '../referralService';

function user(id: string, email: string, phone?: string): StoredUser {
  const t = new Date().toISOString();
  return {
    id,
    email,
    name: id,
    phone,
    role: UserRole.OWNER,
    pets: [],
    createdAt: t,
    updatedAt: t,
    isEmailVerified: true,
    twoFactorEnabled: false,
  };
}

describe('referralService fraud prevention', () => {
  beforeEach(() => {
    store.users.clear();
    store.pets.clear();
    store.medicalRecords.clear();
    store.referralCodes.clear();
    store.referrals.clear();
    store.referralCredits.clear();
  });

  it('generates a stable unique referral code per user', () => {
    store.users.set('referrer-1', user('referrer-1', 'referrer@test.com'));

    const first = referralService.ensureReferralCode('referrer-1');
    const second = referralService.ensureReferralCode('referrer-1');

    expect(first).toEqual(second);
    expect(first).toHaveLength(8);
  });

  it('prevents self-referral', () => {
    store.users.set('user-1', user('user-1', 'person@test.com'));
    const code = referralService.ensureReferralCode('user-1');

    expect(() => referralService.createPendingReferral(code, 'user-1')).toThrow(
      'Self-referrals are not allowed',
    );
  });

  it('blocks repeated converted accounts from the same device for one referrer', () => {
    store.users.set('referrer-1', user('referrer-1', 'referrer@test.com'));
    store.users.set('referred-1', user('referred-1', 'one@test.com'));
    store.users.set('referred-2', user('referred-2', 'two@test.com'));
    store.pets.set('pet-1', {
      id: 'pet-1',
      name: 'Buddy',
      species: 'dog',
      ownerId: 'referred-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const code = referralService.ensureReferralCode('referrer-1');

    const first = referralService.createPendingReferral(code, 'referred-1', {
      deviceFingerprint: 'same-device',
    });
    store.medicalRecords.set('record-1', {
      id: 'record-1',
      petId: 'pet-1',
      vetId: 'vet-1',
      type: 'vaccination',
      visitDate: '2026-05-30',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const conversion = referralService.completeReferralConversion('referred-1', 'record-1');
    const second = referralService.createPendingReferral(code, 'referred-2', {
      deviceFingerprint: 'same-device',
    });

    expect(first.status).toBe('pending');
    expect(conversion?.referral.status).toBe('converted');
    expect(conversion?.credit?.amount).toBe(30);
    expect(second.status).toBe('blocked');
    expect(second.blockReason).toBe('device_already_converted');
  });

  it('awards one credit only after the referred user creates their first record', () => {
    store.users.set('referrer-1', user('referrer-1', 'referrer@test.com'));
    store.users.set('referred-1', user('referred-1', 'one@test.com'));
    store.pets.set('pet-1', {
      id: 'pet-1',
      name: 'Buddy',
      species: 'dog',
      ownerId: 'referred-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const code = referralService.ensureReferralCode('referrer-1');
    referralService.createPendingReferral(code, 'referred-1');

    store.medicalRecords.set('record-1', {
      id: 'record-1',
      petId: 'pet-1',
      vetId: 'vet-1',
      type: 'vaccination',
      visitDate: '2026-05-30',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    referralService.completeReferralConversion('referred-1', 'record-1');
    referralService.completeReferralConversion('referred-1', 'record-1');
    const stats = referralService.getReferralStats('referrer-1');

    expect(stats.successfulConversions).toBe(1);
    expect(stats.earnedPremiumDays).toBe(30);
    expect(store.referralCredits.size).toBe(1);
  });
});
