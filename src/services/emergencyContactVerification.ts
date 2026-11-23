import { Linking } from 'react-native';

import { getItem, setItem } from './localDB';

/**
 * SMS verification for emergency contacts (Issue #1366).
 *
 * A contact is unverified until the 6-digit code sent to its number is
 * confirmed. Codes expire after 10 minutes and can be resent after 60 seconds.
 */

export const VERIFICATION_CODE_LENGTH = 6;
export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

const PENDING_KEY = '@emergency_contact_verifications';

export interface PendingVerification {
  contactId: string;
  phoneNumber: string;
  code: string;
  /** Epoch ms after which the code is no longer accepted. */
  expiresAt: number;
  /** Epoch ms before which a resend is refused. */
  resendAvailableAt: number;
  attempts: number;
}

export type VerificationStatus =
  | { state: 'verified' }
  | { state: 'pending'; expiresAt: number; resendAvailableAt: number }
  | { state: 'expired' }
  | { state: 'none' };

export type ConfirmResult =
  | { ok: true }
  | { ok: false; reason: 'no-pending' | 'expired' | 'invalid' | 'too-many-attempts' };

export type ResendResult =
  | { ok: true; expiresAt: number; resendAvailableAt: number }
  | { ok: false; reason: 'no-pending' | 'cooldown'; retryAfterMs?: number };

const MAX_ATTEMPTS = 5;

/** Generates a zero-padded 6-digit code. */
export function generateVerificationCode(random: () => number = Math.random): string {
  const value = Math.floor(random() * 10 ** VERIFICATION_CODE_LENGTH);
  return String(value).padStart(VERIFICATION_CODE_LENGTH, '0');
}

/** True when `code` is a well-formed 6-digit verification code. */
export function isValidCodeFormat(code: string): boolean {
  return new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`).test(code.trim());
}

async function loadPending(): Promise<Record<string, PendingVerification>> {
  const stored = await getItem(PENDING_KEY);
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function savePending(map: Record<string, PendingVerification>): Promise<void> {
  await setItem(PENDING_KEY, JSON.stringify(map));
}

/** Sends the code over SMS via the platform messaging app. */
async function sendSms(phoneNumber: string, code: string): Promise<void> {
  const body = encodeURIComponent(
    `Your PetChain emergency contact verification code is ${code}. It expires in 10 minutes.`,
  );
  const separator = phoneNumber.includes('?') ? '&' : '?';
  await Linking.openURL(`sms:${phoneNumber}${separator}body=${body}`);
}

export const emergencyContactVerification = {
  /**
   * Creates a fresh code for `contactId`, sends it by SMS and stores it as
   * pending. The contact stays unverified until `confirm` succeeds.
   */
  async start(
    contactId: string,
    phoneNumber: string,
    now: number = Date.now(),
  ): Promise<PendingVerification> {
    const code = generateVerificationCode();
    const pending: PendingVerification = {
      contactId,
      phoneNumber,
      code,
      expiresAt: now + VERIFICATION_CODE_TTL_MS,
      resendAvailableAt: now + VERIFICATION_RESEND_COOLDOWN_MS,
      attempts: 0,
    };
    const map = await loadPending();
    map[contactId] = pending;
    await savePending(map);
    await sendSms(phoneNumber, code);
    return pending;
  },

  /** Current verification state for a contact. */
  async status(contactId: string, now: number = Date.now()): Promise<VerificationStatus> {
    const map = await loadPending();
    const pending = map[contactId];
    if (!pending) return { state: 'none' };
    if (pending.expiresAt <= now) return { state: 'expired' };
    return {
      state: 'pending',
      expiresAt: pending.expiresAt,
      resendAvailableAt: pending.resendAvailableAt,
    };
  },

  /** Confirms a code. On success the pending record is cleared (verified). */
  async confirm(contactId: string, code: string, now: number = Date.now()): Promise<ConfirmResult> {
    const map = await loadPending();
    const pending = map[contactId];
    if (!pending) return { ok: false, reason: 'no-pending' };
    if (pending.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (pending.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too-many-attempts' };

    if (pending.code !== code.trim()) {
      pending.attempts += 1;
      map[contactId] = pending;
      await savePending(map);
      return { ok: false, reason: 'invalid' };
    }

    delete map[contactId];
    await savePending(map);
    return { ok: true };
  },

  /** Resends the code, honouring the 60 second cooldown. */
  async resend(contactId: string, now: number = Date.now()): Promise<ResendResult> {
    const map = await loadPending();
    const pending = map[contactId];
    if (!pending) return { ok: false, reason: 'no-pending' };
    if (pending.resendAvailableAt > now) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterMs: pending.resendAvailableAt - now,
      };
    }
    const refreshed = await this.start(contactId, pending.phoneNumber, now);
    return { ok: true, expiresAt: refreshed.expiresAt, resendAvailableAt: refreshed.resendAvailableAt };
  },

  /** Drops any pending verification (e.g. contact deleted). */
  async clear(contactId: string): Promise<void> {
    const map = await loadPending();
    if (!(contactId in map)) return;
    delete map[contactId];
    await savePending(map);
  },
};

export default emergencyContactVerification;
