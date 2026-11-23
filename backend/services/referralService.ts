import crypto from 'crypto';

import { store, type StoredReferral, type StoredReferralCredit } from '../server/store';
import { SUBSCRIPTION_PLANS } from '../models/Payment';
import { decimalToUnits, unitsToDecimal } from '../utils/decimal';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const PREMIUM_DAYS_PER_CONVERSION = 30;
const MAX_PENDING_PER_DEVICE = 3;
const CREDIT_SCALE = 2;
const DEFAULT_INVOICE_PLAN = 'premium_monthly' as const;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,200}$/;

export interface ReferralFraudSignals {
  deviceFingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ReferralStats {
  code: string;
  pendingConversions: number;
  successfulConversions: number;
  blockedConversions: number;
  earnedPremiumDays: number;
  availablePremiumDays: number;
  referrals: Array<{
    id: string;
    referredUserId: string;
    status: StoredReferral['status'];
    signupAt: string;
    convertedAt?: string;
    blockReason?: string;
  }>;
  credits: StoredReferralCredit[];
}

export interface ReferralRedemptionResult {
  redemptionId: string;
  userId: string;
  idempotencyKey: string;
  requestedAmount: number;
  appliedAmount: number;
  invoiceTotal: number;
  invoiceRemaining: number;
  creditIds: string[];
  createdAt: string;
  replayed: boolean;
}

export interface RedeemReferralCreditsInput {
  userId: string;
  amount: number;
  idempotencyKey: string;
  invoiceTotal?: number;
}

function hashSignal(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const index = crypto.randomInt(0, CODE_ALPHABET.length);
    code += CODE_ALPHABET[index];
  }
  return code;
}

function normalizeCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function userByReferralCode(code: string) {
  const normalized = normalizeCode(code);
  const row = store.referralCodes.get(normalized);
  return row ? store.users.get(row.userId) : undefined;
}

function blockReferral(referral: StoredReferral, reason: string): StoredReferral {
  const blocked = {
    ...referral,
    status: 'blocked' as const,
    blockedAt: new Date().toISOString(),
    blockReason: reason,
  };
  store.referrals.set(blocked.id, blocked);
  return blocked;
}

export function ensureReferralCode(userId: string): string {
  const existing = [...store.referralCodes.values()].find((row) => row.userId === userId);
  if (existing) return existing.code;

  let code = generateCode();
  while (store.referralCodes.has(code)) {
    code = generateCode();
  }

  store.referralCodes.set(code, {
    userId,
    code,
    createdAt: new Date().toISOString(),
  });
  return code;
}

export function createPendingReferral(
  referralCode: string,
  referredUserId: string,
  signals: ReferralFraudSignals = {},
): StoredReferral {
  const normalizedCode = normalizeCode(referralCode);
  const referrer = userByReferralCode(normalizedCode);
  const referred = store.users.get(referredUserId);

  if (!referrer) {
    throw new Error('Referral code not found');
  }
  if (!referred) {
    throw new Error('Referred user not found');
  }
  if (referrer.id === referred.id) {
    throw new Error('Self-referrals are not allowed');
  }

  const existing = [...store.referrals.values()].find(
    (referral) => referral.referredUserId === referredUserId,
  );
  if (existing) {
    throw new Error('User already has a referral attribution');
  }

  const ipHash = hashSignal(signals.ipAddress);
  const userAgentHash = hashSignal(signals.userAgent);
  const deviceFingerprint = hashSignal(signals.deviceFingerprint);
  const sameEmail = referrer.email.trim().toLowerCase() === referred.email.trim().toLowerCase();
  const samePhone =
    referrer.phone?.trim() && referred.phone?.trim()
      ? referrer.phone.trim() === referred.phone.trim()
      : false;

  const t = new Date().toISOString();
  const referral: StoredReferral = {
    id: store.newId(),
    referrerUserId: referrer.id,
    referredUserId,
    referralCode: normalizedCode,
    status: 'pending',
    signupAt: t,
    deviceFingerprint,
    ipHash,
    userAgentHash,
  };

  if (sameEmail || samePhone) {
    return blockReferral(referral, 'matching_identity');
  }

  if (deviceFingerprint) {
    const deviceMatches = [...store.referrals.values()].filter(
      (row) => row.referrerUserId === referrer.id && row.deviceFingerprint === deviceFingerprint,
    );
    if (deviceMatches.some((row) => row.status === 'converted')) {
      return blockReferral(referral, 'device_already_converted');
    }
    if (deviceMatches.filter((row) => row.status === 'pending').length >= MAX_PENDING_PER_DEVICE) {
      return blockReferral(referral, 'device_pending_limit');
    }
  }

  if (ipHash) {
    const convertedFromIp = [...store.referrals.values()].some(
      (row) =>
        row.referrerUserId === referrer.id && row.ipHash === ipHash && row.status === 'converted',
    );
    if (convertedFromIp) {
      return blockReferral(referral, 'ip_already_converted');
    }
  }

  store.referrals.set(referral.id, referral);
  return referral;
}

export function completeReferralConversion(
  referredUserId: string,
  firstRecordId: string,
): { referral: StoredReferral; credit?: StoredReferralCredit } | null {
  const referral = [...store.referrals.values()].find(
    (row) => row.referredUserId === referredUserId,
  );
  if (!referral || referral.status === 'converted' || referral.status === 'blocked') {
    return referral ? { referral } : null;
  }

  const firstRecord = store.medicalRecords.get(firstRecordId);
  const firstRecordPet = firstRecord ? store.pets.get(firstRecord.petId) : undefined;
  if (!firstRecord || firstRecordPet?.ownerId !== referredUserId) {
    return { referral };
  }

  const petRecordCount = [...store.medicalRecords.values()].filter((record) => {
    const pet = store.pets.get(record.petId);
    return pet?.ownerId === referredUserId;
  }).length;

  if (petRecordCount > 1) {
    return { referral };
  }

  const t = new Date().toISOString();
  const converted: StoredReferral = {
    ...referral,
    status: 'converted',
    convertedAt: t,
    firstRecordId,
  };
  store.referrals.set(converted.id, converted);

  const credit: StoredReferralCredit = {
    id: store.newId(),
    userId: converted.referrerUserId,
    referralId: converted.id,
    creditType: 'premium_days',
    amount: PREMIUM_DAYS_PER_CONVERSION,
    status: 'active',
    awardedAt: t,
  };
  store.referralCredits.set(credit.id, credit);

  return { referral: converted, credit };
}

export function redeemReferralCredits(input: RedeemReferralCreditsInput): ReferralRedemptionResult {
  const { userId, amount, idempotencyKey } = input;
  const key = idempotencyKey?.trim();

  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new Error('Invalid idempotency key');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Redemption amount must be greater than zero');
  }

  const requestedUnits = decimalToUnits(amount.toFixed(CREDIT_SCALE), CREDIT_SCALE);
  if (requestedUnits <= 0n) {
    throw new Error('Redemption amount must be greater than zero');
  }

  const scopedKey = `${userId}:${key}`;
  const previous = store.referralRedemptions.get(scopedKey);
  if (previous) {
    if (previous.requestedAmount !== amount) {
      throw new Error('Idempotency key was already used for a different redemption');
    }
    return { ...previous, replayed: true };
  }

  const invoiceTotal = input.invoiceTotal ?? Number(SUBSCRIPTION_PLANS[DEFAULT_INVOICE_PLAN].priceMonthly);
  if (!Number.isFinite(invoiceTotal) || invoiceTotal < 0) {
    throw new Error('Invalid invoice total');
  }
  const invoiceUnits = decimalToUnits(invoiceTotal.toFixed(CREDIT_SCALE), CREDIT_SCALE);

  const activeCredits = [...store.referralCredits.values()]
    .filter((credit) => credit.userId === userId && credit.status === 'active')
    .sort((a, b) => new Date(a.awardedAt).getTime() - new Date(b.awardedAt).getTime());

  const availableUnits = activeCredits.reduce(
    (sum, credit) => sum + decimalToUnits(credit.amount.toFixed(CREDIT_SCALE), CREDIT_SCALE),
    0n,
  );

  if (availableUnits <= 0n) {
    throw new Error('No referral credits available');
  }

  const appliedUnits = requestedUnits < availableUnits ? requestedUnits : availableUnits;
  if (appliedUnits > invoiceUnits) {
    throw new Error('Redemption amount exceeds invoice total');
  }

  const t = new Date().toISOString();
  const creditIds: string[] = [];
  let remaining = appliedUnits;
  for (const credit of activeCredits) {
    if (remaining <= 0n) break;
    const creditUnits = decimalToUnits(credit.amount.toFixed(CREDIT_SCALE), CREDIT_SCALE);
    if (creditUnits <= remaining) {
      store.referralCredits.set(credit.id, { ...credit, status: 'redeemed' });
      creditIds.push(credit.id);
      remaining -= creditUnits;
    }
  }

  const redemption = {
    id: store.newId(),
    userId,
    idempotencyKey: key,
    requestedAmount: amount,
    appliedAmount: Number(unitsToDecimal(appliedUnits, CREDIT_SCALE)),
    invoiceTotal,
    invoiceRemaining: Number(unitsToDecimal(invoiceUnits - appliedUnits, CREDIT_SCALE)),
    creditIds,
    createdAt: t,
  };
  store.referralRedemptions.set(scopedKey, redemption);

  return { ...redemption, replayed: false };
}

export function getReferralStats(userId: string): ReferralStats {
  const code = ensureReferralCode(userId);
  const referrals = [...store.referrals.values()].filter((row) => row.referrerUserId === userId);
  const credits = [...store.referralCredits.values()].filter((row) => row.userId === userId);

  return {
    code,
    pendingConversions: referrals.filter((row) => row.status === 'pending').length,
    successfulConversions: referrals.filter((row) => row.status === 'converted').length,
    blockedConversions: referrals.filter((row) => row.status === 'blocked').length,
    earnedPremiumDays: credits.reduce((sum, credit) => sum + credit.amount, 0),
    availablePremiumDays: credits
      .filter((credit) => credit.status === 'active')
      .reduce((sum, credit) => sum + credit.amount, 0),
    referrals: referrals
      .sort((a, b) => new Date(b.signupAt).getTime() - new Date(a.signupAt).getTime())
      .map((row) => ({
        id: row.id,
        referredUserId: row.referredUserId,
        status: row.status,
        signupAt: row.signupAt,
        convertedAt: row.convertedAt,
        blockReason: row.blockReason,
      })),
    credits,
  };
}

export default {
  ensureReferralCode,
  createPendingReferral,
  completeReferralConversion,
  redeemReferralCredits,
  getReferralStats,
};
