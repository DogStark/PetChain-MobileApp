/**
 * Two-factor authentication enforcement policy for vet accounts (#1394).
 *
 * Vets access sensitive medical records, so 2FA is mandatory for them. When a
 * vet without 2FA is first seen after the policy is active, a grace period
 * (VET_2FA_GRACE_DAYS, default 7) starts. After it ends, API requests are
 * rejected with 403 TWO_FACTOR_SETUP_REQUIRED until 2FA is set up.
 * Every policy event is written to the audit trail.
 */

import auditLogService from './auditLogService';
import { UserRole } from '../models/UserRole';
import { store } from '../server/store';

export const TWO_FACTOR_SETUP_REQUIRED = 'TWO_FACTOR_SETUP_REQUIRED';

export interface VetTwoFactorPolicy {
  /** Set VET_2FA_REQUIRED=false to deactivate the policy. */
  enabled: boolean;
  graceDays: number;
}

export function getVetTwoFactorPolicy(env: NodeJS.ProcessEnv = process.env): VetTwoFactorPolicy {
  const grace = Number(env.VET_2FA_GRACE_DAYS);
  return {
    enabled: env.VET_2FA_REQUIRED !== 'false',
    graceDays: Number.isFinite(grace) && grace >= 0 ? grace : 7,
  };
}

export type VetTwoFactorStatus =
  | { required: false }
  | { required: true; enforced: boolean; deadline: string };

/**
 * Evaluates the policy for a user, starting their grace period the first
 * time a vet without 2FA is seen after the policy is active.
 */
export function evaluateVetTwoFactor(
  userId: string,
  now: Date = new Date(),
  policy: VetTwoFactorPolicy = getVetTwoFactorPolicy(),
): VetTwoFactorStatus {
  if (!policy.enabled) return { required: false };
  const user = store.users.get(userId);
  if (!user || user.role !== UserRole.VET || user.twoFactorEnabled) {
    return { required: false };
  }

  let graceStartedAt = user.twoFactorGraceStartedAt;
  if (!graceStartedAt) {
    graceStartedAt = now.toISOString();
    store.users.set(user.id, { ...user, twoFactorGraceStartedAt: graceStartedAt });
    auditLogService.log({
      actorId: user.id,
      actorEmail: user.email,
      role: user.role,
      action: 'auth.2fa_policy.grace_started',
      resourceType: 'user',
      resourceId: user.id,
      meta: { graceDays: policy.graceDays },
    });
  }

  const deadline = new Date(
    new Date(graceStartedAt).getTime() + policy.graceDays * 24 * 60 * 60 * 1000,
  );
  return {
    required: true,
    enforced: now.getTime() >= deadline.getTime(),
    deadline: deadline.toISOString(),
  };
}

/** Requests needed to set up 2FA (or sign out) stay allowed when enforced. */
export function isTwoFactorSetupPath(url: string): boolean {
  return /\/auth\/(2fa\/|logout\b)/.test(url);
}

/** Audit entry for a request blocked by the policy. */
export function logTwoFactorEnforcement(
  user: { id: string; email: string; role: UserRole },
  path: string,
): void {
  auditLogService.log({
    actorId: user.id,
    actorEmail: user.email,
    role: user.role,
    action: 'auth.2fa_policy.enforced',
    resourceType: 'user',
    resourceId: user.id,
    meta: { path },
    outcome: 'denied',
  });
}
