/**
 * Inactive-account data retention policy (#1400).
 *
 *  1. Accounts inactive for RETENTION_WARNING_MONTHS (default 18) receive an
 *     email warning.
 *  2. Accounts inactive for RETENTION_INACTIVE_MONTHS (default 24) are
 *     soft-deleted and enter a RETENTION_RECOVERY_DAYS (default 90) recovery
 *     window.
 *  3. After the recovery window the account data is permanently purged.
 *
 * Inactivity is measured from last_login_at (or created_at if the user never
 * logged in). Every step is written to the HIPAA audit log (audit_logs).
 */

import auditLogService from './auditLogService';
import { store } from '../server/store';
import { query } from '../src/db';
import logger from '../utils/logger';

export interface RetentionConfig {
  warningMonths: number;
  inactiveMonths: number;
  recoveryDays: number;
  /** How often the scheduled job runs. */
  intervalHours: number;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Reads the policy from the environment. */
export function getRetentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  return {
    warningMonths: positiveNumber(env.RETENTION_WARNING_MONTHS, 18),
    inactiveMonths: positiveNumber(env.RETENTION_INACTIVE_MONTHS, 24),
    recoveryDays: positiveNumber(env.RETENTION_RECOVERY_DAYS, 90),
    intervalHours: positiveNumber(env.RETENTION_JOB_INTERVAL_HOURS, 24),
  };
}

function monthsBefore(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
}

function daysBefore(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Writes a retention step to the HIPAA audit log. */
function auditRetention(
  action: string,
  userId: string,
  meta: Record<string, unknown>,
): void {
  auditLogService.log({
    actorId: userId,
    role: 'system',
    action,
    resourceType: 'user',
    resourceId: userId,
    meta: { automated: true, policy: 'data_retention', ...meta },
  });
}

async function sendInactivityWarning(
  email: string,
  config: RetentionConfig,
): Promise<boolean> {
  const subject = 'Your PetChain account will be deleted due to inactivity';
  const text =
    `We haven't seen you on PetChain for ${config.warningMonths} months. ` +
    `If you don't sign in, your account will be deactivated after ` +
    `${config.inactiveMonths} months of inactivity and permanently deleted ` +
    `${config.recoveryDays} days after that. Sign in at any time to keep your account.`;

  const mailerPath = process.env.MAILER_MODULE;
  if (!mailerPath) {
    logger.warn('[retention] No mailer configured; inactivity warning not emailed', { email });
    return false;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mailer = require(mailerPath) as { sendMail: (opts: any) => Promise<void> };
    await mailer.sendMail({ to: email, subject, text });
    return true;
  } catch (err) {
    logger.error('[retention] Failed to send inactivity warning', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export interface RetentionRunResult {
  warned: number;
  softDeleted: number;
  purged: number;
}

/** Runs all three retention steps once. */
export async function runRetentionPolicy(
  now: Date = new Date(),
  config: RetentionConfig = getRetentionConfig(),
): Promise<RetentionRunResult> {
  const warnCutoff = monthsBefore(now, config.warningMonths);
  const inactiveCutoff = monthsBefore(now, config.inactiveMonths);
  const purgeCutoff = daysBefore(now, config.recoveryDays);
  const result: RetentionRunResult = { warned: 0, softDeleted: 0, purged: 0 };

  // 1. Warn accounts inactive for warningMonths (once).
  const toWarn = await query(
    `SELECT id, email, COALESCE(last_login_at, created_at) AS last_active
       FROM users
      WHERE deleted_at IS NULL
        AND retention_warning_sent_at IS NULL
        AND COALESCE(last_login_at, created_at) < $1
        AND COALESCE(last_login_at, created_at) >= $2`,
    [warnCutoff, inactiveCutoff],
  );
  for (const row of toWarn.rows) {
    const emailed = await sendInactivityWarning(row.email, config);
    await query('UPDATE users SET retention_warning_sent_at = $1 WHERE id = $2', [now, row.id]);
    auditRetention('retention.inactivity_warning_sent', row.id, {
      lastActiveAt: row.last_active,
      emailed,
    });
    result.warned += 1;
  }

  // 2. Soft-delete accounts inactive for inactiveMonths.
  const toSoftDelete = await query(
    `SELECT id, COALESCE(last_login_at, created_at) AS last_active
       FROM users
      WHERE deleted_at IS NULL
        AND COALESCE(last_login_at, created_at) < $1`,
    [inactiveCutoff],
  );
  for (const row of toSoftDelete.rows) {
    await query(
      'UPDATE users SET deleted_at = $1, retention_soft_deleted_at = $1 WHERE id = $2',
      [now, row.id],
    );
    const stored = store.users.get(row.id);
    if (stored) store.users.set(row.id, { ...stored, deletedAt: now.toISOString() });
    auditRetention('retention.account_soft_deleted', row.id, {
      lastActiveAt: row.last_active,
      recoverableUntil: new Date(
        now.getTime() + config.recoveryDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
    result.softDeleted += 1;
  }

  // 3. Permanently purge accounts whose recovery window has passed.
  const toPurge = await query(
    `SELECT id, retention_soft_deleted_at
       FROM users
      WHERE retention_soft_deleted_at IS NOT NULL
        AND retention_soft_deleted_at < $1`,
    [purgeCutoff],
  );
  for (const row of toPurge.rows) {
    // Audit first so the record exists even though the user row is removed.
    auditRetention('retention.account_purged', row.id, {
      softDeletedAt: row.retention_soft_deleted_at,
    });
    await query('DELETE FROM users WHERE id = $1', [row.id]);
    store.users.delete(row.id);
    result.purged += 1;
  }

  logger.info('[retention] Policy run complete', { ...result });
  return result;
}

/**
 * Restores an account soft-deleted by the retention policy, if it is still
 * within the recovery window (e.g. when the user signs in again).
 */
export async function recoverAccount(
  userId: string,
  now: Date = new Date(),
  config: RetentionConfig = getRetentionConfig(),
): Promise<boolean> {
  const res = await query(
    `UPDATE users
        SET deleted_at = NULL,
            retention_soft_deleted_at = NULL,
            retention_warning_sent_at = NULL,
            last_login_at = $1
      WHERE id = $2
        AND retention_soft_deleted_at IS NOT NULL
        AND retention_soft_deleted_at >= $3`,
    [now, userId, daysBefore(now, config.recoveryDays)],
  );
  const recovered = (res.rowCount ?? 0) > 0;
  if (recovered) {
    const stored = store.users.get(userId);
    if (stored) store.users.set(userId, { ...stored, deletedAt: undefined });
    auditRetention('retention.account_recovered', userId, {});
  }
  return recovered;
}

/**
 * Starts the scheduled retention job. Opt-in via DATA_RETENTION_ENABLED=true
 * because it permanently deletes data.
 */
export function startDataRetentionJob(
  config: RetentionConfig = getRetentionConfig(),
): NodeJS.Timeout | null {
  if (process.env.DATA_RETENTION_ENABLED !== 'true') return null;
  const run = () =>
    runRetentionPolicy(new Date(), config).catch((err) =>
      logger.error('[retention] Policy run failed', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  void run();
  return setInterval(run, config.intervalHours * 60 * 60 * 1000) as unknown as NodeJS.Timeout;
}

export default {
  getRetentionConfig,
  runRetentionPolicy,
  recoverAccount,
  startDataRetentionJob,
};
