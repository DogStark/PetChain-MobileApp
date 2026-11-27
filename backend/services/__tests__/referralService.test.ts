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
    store.referralRedemptions.clear();
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

describe('referralService credit redemption', () => {
  function seedCredit(id: string, userId: string, amount: number) {
    store.referralCredits.set(id, {
      id,
      userId,
      referralId: `referral-${id}`,
      creditType: 'premium_days',
      amount,
      status: 'active',
      awardedAt: new Date().toISOString(),
    });
  }

  beforeEach(() => {
    store.users.clear();
    store.referralCodes.clear();
    store.referrals.clear();
    store.referralCredits.clear();
    store.referralRedemptions.clear();
  });

  it('applies credits to the next invoice and marks them redeemed', () => {
    seedCredit('credit-1', 'user-1', 5);

    const result = referralService.redeemReferralCredits({
      userId: 'user-1',
      amount: 5,
      idempotencyKey: 'key-1',
      invoiceTotal: 9.99,
    });

    expect(result.appliedAmount).toBe(5);
    expect(result.invoiceRemaining).toBe(4.99);
    expect(result.replayed).toBe(false);
    expect(store.referralCredits.get('credit-1')?.status).toBe('redeemed');
    expect(referralService.getReferralStats('user-1').availablePremiumDays).toBe(0);
  });

  it('replays the same redemption for a repeated idempotency key', () => {
    seedCredit('credit-1', 'user-1', 5);

    const first = referralService.redeemReferralCredits({
      userId: 'user-1',
      amount: 5,
      idempotencyKey: 'key-1',
      invoiceTotal: 9.99,
    });
    const second = referralService.redeemReferralCredits({
      userId: 'user-1',
      amount: 5,
      idempotencyKey: 'key-1',
      invoiceTotal: 9.99,
    });

    expect(second.redemptionId).toBe(first.redemptionId);
    expect(second.replayed).toBe(true);
    expect(store.referralRedemptions.size).toBe(1);
  });

  it('rejects an idempotency key reused with a different amount', () => {
    seedCredit('credit-1', 'user-1', 5);

    referralService.redeemReferralCredits({
      userId: 'user-1',
      amount: 2,
      idempotencyKey: 'key-1',
      invoiceTotal: 9.99,
    });

    expect(() =>
      referralService.redeemReferralCredits({
        userId: 'user-1',
        amount: 3,
        idempotencyKey: 'key-1',
        invoiceTotal: 9.99,
      }),
    ).toThrow('Idempotency key was already used for a different redemption');
  });

  it('prevents over-redemption beyond the invoice total', () => {
    seedCredit('credit-1', 'user-1', 20);

    expect(() =>
      referralService.redeemReferralCredits({
        userId: 'user-1',
        amount: 20,
        idempotencyKey: 'key-1',
        invoiceTotal: 9.99,
      }),
    ).toThrow('Redemption amount exceeds invoice total');
    expect(store.referralCredits.get('credit-1')?.status).toBe('active');
    expect(store.referralRedemptions.size).toBe(0);
  });

  it('caps the applied amount at the available credit balance', () => {
    seedCredit('credit-1', 'user-1', 3);

    const result = referralService.redeemReferralCredits({
      userId: 'user-1',
      amount: 5,
      idempotencyKey: 'key-1',
      invoiceTotal: 9.99,
    });

    expect(result.appliedAmount).toBe(3);
    expect(result.invoiceRemaining).toBe(6.99);
  });

  it('rejects redemption when the user has no active credits', () => {
    expect(() =>
      referralService.redeemReferralCredits({
        userId: 'user-1',
        amount: 1,
        idempotencyKey: 'key-1',
        invoiceTotal: 9.99,
      }),
    ).toThrow('No referral credits available');
  });
});
