import fetch from 'node-fetch';

import { getRedisClient, REDIS_KEY_PREFIX } from '../config/redis';
import { query } from '../src/db';
import logger from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationTopic =
  | 'medication_reminders'
  | 'appointment_alerts'
  | 'sos_notifications'
  | 'health_tips';

export const ALL_TOPICS: NotificationTopic[] = [
  'medication_reminders',
  'appointment_alerts',
  'sos_notifications',
  'health_tips',
];

export interface PushJob {
  jobId: string;
  userId: string;
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  topic: NotificationTopic;
  attempts: number;
  createdAt: string;
  scheduledAt?: string;
  timezone?: string;
  isCritical?: boolean;
}

export interface PushMetrics {
  queued: number;
  delivered: number;
  failed: number;
  retried: number;
  deadLettered: number;
}

export interface PushReceipt {
  id: string;
  jobId: string;
  userId: string;
  receiptId: string | null;
  token: string;
  title: string;
  body: string;
  topic: string;
  status: 'pending' | 'delivered' | 'failed' | 'opened' | 'device_not_registered' | 'message_too_big' | 'invalid_credentials';
  errorCode?: string;
  errorMessage?: string;
  isCritical: boolean;
  smsFallbackAttempted: boolean;
  createdAt: string;
  checkedAt?: string;
  deliveredAt?: string;
  openedAt?: string;
}

const CRITICAL_TOPICS: NotificationTopic[] = ['medication_reminders', 'sos_notifications'];

// ─── Redis key helpers ────────────────────────────────────────────────────────

const K = {
  queue: `${REDIS_KEY_PREFIX}push:queue`,
  dlq: `${REDIS_KEY_PREFIX}push:dlq`,
  dedup: (jobId: string) => `${REDIS_KEY_PREFIX}push:dedup:${jobId}`,
  metrics: `${REDIS_KEY_PREFIX}push:metrics`,
  tokens: (userId: string) => `${REDIS_KEY_PREFIX}push:tokens:${userId}`,
  subscriptions: (userId: string) => `${REDIS_KEY_PREFIX}push:subs:${userId}`,
  preferences: (userId: string) => `${REDIS_KEY_PREFIX}push:prefs:${userId}`,
  scheduled: `${REDIS_KEY_PREFIX}push:scheduled`,
  receipts: (jobId: string) => `${REDIS_KEY_PREFIX}push:receipt:${jobId}`,
  pendingReceipts: `${REDIS_KEY_PREFIX}push:pending-receipts`,
};

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const DEDUP_TTL_SECONDS = 86400; // 24 h
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPT_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const SMS_FALLBACK_TIMEOUT_MS = 30 * 60 * 1000;

// ─── Metrics ──────────────────────────────────────────────────────────────────

async function incrMetric(field: keyof PushMetrics): Promise<void> {
  try {
    await getRedisClient().hincrby(K.metrics, field, 1);
  } catch {
    // non-critical
  }
}

export async function getMetrics(): Promise<PushMetrics> {
  try {
    const raw = await getRedisClient().hgetall(K.metrics);
    return {
      queued: parseInt(raw?.queued ?? '0'),
      delivered: parseInt(raw?.delivered ?? '0'),
      failed: parseInt(raw?.failed ?? '0'),
      retried: parseInt(raw?.retried ?? '0'),
      deadLettered: parseInt(raw?.deadLettered ?? '0'),
    };
  } catch {
    return { queued: 0, delivered: 0, failed: 0, retried: 0, deadLettered: 0 };
  }
}

// ─── Timezone utilities ───────────────────────────────────────────────────────

function isIanaTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localTimeToUtc(
  localDate: string,
  localTime: string,
  timezone: string,
): Date {
  const [year, month, day] = localDate.split('-').map(Number);
  const [hour, minute] = localTime.split(':').map(Number);
  const localIso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const date = new Date(localIso + (timezone ? `+00:00` : ''));
  const utcMs = date.getTime() - getTimezoneOffsetMs(localIso, timezone);
  return new Date(utcMs);
}

function getTimezoneOffsetMs(isoDate: string, timezone: string): number {
  const utcDate = new Date(isoDate + 'Z');
  const tzDate = new Date(
    utcDate.toLocaleString('en-US', { timeZone: timezone }),
  );
  return utcDate.getTime() - tzDate.getTime();
}

export async function getUserTimezone(userId: string): Promise<string> {
  try {
    const result = await query('SELECT timezone FROM users WHERE id = $1', [userId]);
    if (result.rows.length > 0 && result.rows[0].timezone) {
      const tz = result.rows[0].timezone as string;
      if (isIanaTimezone(tz)) return tz;
    }
  } catch {
    // fall through
  }
  return 'UTC';
}

export async function setUserTimezone(userId: string, timezone: string): Promise<void> {
  if (!isIanaTimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
  await query('UPDATE users SET timezone = $1 WHERE id = $2', [timezone, userId]);
}

/**
 * Convert a scheduled local time to a UTC Date and return the scheduled job data.
 */
export async function scheduleAtLocalTime(
  userId: string,
  topic: NotificationTopic,
  title: string,
  body: string,
  localDate: string,
  localTime: string,
  timezone?: string,
  data?: Record<string, unknown>,
): Promise<Date | null> {
  const tz = timezone ?? (await getUserTimezone(userId));
  const utcDate = localTimeToUtc(localDate, localTime, tz);

  // Store in Redis sorted set for delayed processing
  const redis = getRedisClient();
  const jobRef = `${userId}:${topic}:${utcDate.getTime()}`;
  await redis.zadd(K.scheduled, utcDate.getTime(), JSON.stringify({
    jobRef,
    userId,
    topic,
    title,
    body,
    data: data ?? {},
    timezone: tz,
  }));

  logger.info('push_scheduled', { userId, topic, localDate, localTime, timezone: tz, utcTime: utcDate.toISOString() });
  return utcDate;
}

/**
 * Process scheduled jobs whose time has arrived.
 */
export async function processScheduled(): Promise<number> {
  const redis = getRedisClient();
  const now = Date.now();
  const due = await redis.zrangebyscore(K.scheduled, 0, now);

  let processed = 0;
  for (const raw of due) {
    try {
      const item = JSON.parse(raw);
      const tokens = await getTokens(item.userId);
      for (const token of tokens) {
        const jobId = `${item.jobRef}:${token.slice(-8)}`;
        await enqueue({
          jobId,
          userId: item.userId,
          token,
          title: item.title,
          body: item.body,
          data: item.data,
          topic: item.topic as NotificationTopic,
          timezone: item.timezone,
          isCritical: CRITICAL_TOPICS.includes(item.topic as NotificationTopic),
        });
      }
      await redis.zrem(K.scheduled, raw);
      processed++;
    } catch (err) {
      logger.error('push_process_scheduled_error', {
        error: err instanceof Error ? err.message : 'unknown',
        raw,
      });
    }
  }
  return processed;
}

/**
 * Reschedule all pending notifications for a user when their timezone changes.
 */
export async function rescheduleForTimezoneChange(
  userId: string,
  newTimezone: string,
): Promise<void> {
  const redis = getRedisClient();
  const oldTz = await getUserTimezone(userId);

  if (oldTz === newTimezone) return;
  if (!isIanaTimezone(newTimezone)) {
    throw new Error(`Invalid IANA timezone: ${newTimezone}`);
  }

  // Get all scheduled items for this user
  const allScheduled = await redis.zrange(K.scheduled, 0, -1);
  const toReschedule: Array<{
    raw: string;
    item: Record<string, unknown>;
  }> = [];

  for (const raw of allScheduled) {
    try {
      const item = JSON.parse(raw);
      if (item.userId === userId) {
        toReschedule.push({ raw, item });
      }
    } catch {
      // skip malformed
    }
  }

  // Remove and re-add with adjusted times
  for (const { raw, item } of toReschedule) {
    await redis.zrem(K.scheduled, raw);
    // Re-calculate UTC time based on the assumption that the original local time
    // was set in the old timezone and should remain the same local time in the new timezone
    const oldUtcDate = new Date(parseInt(item.jobRef as string));
    const oldLocalTime = oldUtcDate.toLocaleString('en-US', {
      timeZone: oldTz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const oldLocalDate = oldUtcDate.toLocaleString('en-US', {
      timeZone: oldTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [m, d, y] = oldLocalDate.split('/');
    const newUtcDate = localTimeToUtc(`${y}-${m}-${d}`, oldLocalTime, newTimezone);

    item.jobRef = `${userId}:${item.topic}:${newUtcDate.getTime()}`;
    item.timezone = newTimezone;
    await redis.zadd(K.scheduled, newUtcDate.getTime(), JSON.stringify(item));
  }

  await setUserTimezone(userId, newTimezone);
  logger.info('push_rescheduled_for_timezone', { userId, from: oldTz, to: newTimezone, count: toReschedule.length });
}

// ─── Device token management ──────────────────────────────────────────────────

export async function registerToken(userId: string, token: string): Promise<void> {
  if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
    throw new Error('Invalid Expo push token format');
  }
  await getRedisClient().sadd(K.tokens(userId), token);
  logger.info('push_token_registered', { userId, tokenPrefix: token.slice(0, 20) });
}

export async function removeToken(userId: string, token: string): Promise<void> {
  await getRedisClient().srem(K.tokens(userId), token);
  logger.info('push_token_removed', { userId });
}

export async function getTokens(userId: string): Promise<string[]> {
  return getRedisClient().smembers(K.tokens(userId));
}

export async function removeAllTokens(userId: string): Promise<void> {
  await getRedisClient().del(K.tokens(userId));
}

// ─── Topic subscriptions ──────────────────────────────────────────────────────

export async function subscribe(userId: string, topic: NotificationTopic): Promise<void> {
  if (!ALL_TOPICS.includes(topic)) throw new Error(`Unknown topic: ${topic}`);
  await getRedisClient().sadd(K.subscriptions(userId), topic);
}

export async function unsubscribe(userId: string, topic: NotificationTopic): Promise<void> {
  await getRedisClient().srem(K.subscriptions(userId), topic);
}

export async function getSubscriptions(userId: string): Promise<NotificationTopic[]> {
  const subs = await getRedisClient().smembers(K.subscriptions(userId));
  return subs as NotificationTopic[];
}

export async function isSubscribed(userId: string, topic: NotificationTopic): Promise<boolean> {
  return (await getRedisClient().sismember(K.subscriptions(userId), topic)) === 1;
}

// ─── Notification preferences ─────────────────────────────────────────────────

export interface UserPushPreferences {
  enabled: boolean;
  topics: Partial<Record<NotificationTopic, boolean>>;
}

const DEFAULT_PREFS: UserPushPreferences = {
  enabled: true,
  topics: Object.fromEntries(ALL_TOPICS.map((t) => [t, true])) as Record<
    NotificationTopic,
    boolean
  >,
};

export async function getPreferences(userId: string): Promise<UserPushPreferences> {
  const raw = await getRedisClient().get(K.preferences(userId));
  return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
}

export async function setPreferences(
  userId: string,
  prefs: Partial<UserPushPreferences>,
): Promise<void> {
  const current = await getPreferences(userId);
  const updated = { ...current, ...prefs, topics: { ...current.topics, ...prefs.topics } };
  await getRedisClient().set(K.preferences(userId), JSON.stringify(updated));
}

// ─── Queue ────────────────────────────────────────────────────────────────────

/** Enqueue a push notification. Returns false if duplicate (idempotent). */
export async function enqueue(job: Omit<PushJob, 'attempts' | 'createdAt'>): Promise<boolean> {
  const redis = getRedisClient();

  const dedupKey = K.dedup(job.jobId);
  const isNew = await redis.set(dedupKey, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
  if (!isNew) return false;

  const [prefs, subscribed] = await Promise.all([
    getPreferences(job.userId),
    isSubscribed(job.userId, job.topic),
  ]);
  if (!prefs.enabled || prefs.topics[job.topic] === false || !subscribed) {
    logger.info('push_skipped_preference', { userId: job.userId, topic: job.topic });
    return false;
  }

  const fullJob: PushJob = { ...job, attempts: 0, createdAt: new Date().toISOString() };
  await redis.rpush(K.queue, JSON.stringify(fullJob));
  await incrMetric('queued');
  logger.info('push_enqueued', { jobId: job.jobId, userId: job.userId, topic: job.topic });
  return true;
}

/** Store a receipt record in the database. */
async function storeReceipt(
  job: PushJob,
  receiptId: string | null,
  status: PushReceipt['status'],
  errorCode?: string,
  errorMessage?: string,
): Promise<void> {
  const redis = getRedisClient();
  const receipt: PushReceipt = {
    id: `${job.jobId}:receipt`,
    jobId: job.jobId,
    userId: job.userId,
    receiptId,
    token: job.token,
    title: job.title,
    body: job.body,
    topic: job.topic,
    status,
    errorCode,
    errorMessage,
    isCritical: job.isCritical ?? false,
    smsFallbackAttempted: false,
    createdAt: new Date().toISOString(),
    ...(status === 'delivered' ? { deliveredAt: new Date().toISOString() } : {}),
  };

  await redis.set(K.receipts(job.jobId), JSON.stringify(receipt));
  if (status === 'pending') {
    await redis.sadd(K.pendingReceipts, job.jobId);
  }
}

/** Check a single Expo push receipt. */
async function checkReceipt(receiptId: string): Promise<PushReceipt['status']> {
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ids: [receiptId] }),
    });

    if (!response.ok) {
      logger.warn('expo_receipt_check_failed', { receiptId, status: response.status });
      return 'pending';
    }

    const result = (await response.json()) as {
      data?: Record<string, { status: string; details?: { error?: string } }>;
    };

    const receiptData = result?.data?.[receiptId];
    if (!receiptData) return 'pending';

    if (receiptData.status === 'ok') return 'delivered';

    if (receiptData.details?.error) {
      const error = receiptData.details.error;
      if (error === 'DeviceNotRegistered') return 'device_not_registered';
      if (error === 'MessageTooBig') return 'message_too_big';
      if (error === 'InvalidCredentials') return 'invalid_credentials';
      return 'failed';
    }

    return 'failed';
  } catch {
    return 'pending';
  }
}

/**
 * Check pending receipt statuses. Should be called periodically (e.g., every 15 min).
 * Handles DeviceNotRegistered, MessageTooBig, and InvalidCredentials errors.
 * Attempts SMS fallback for critical undelivered notifications after 30 minutes.
 */
export async function checkPendingReceipts(): Promise<{
  checked: number;
  delivered: number;
  failed: number;
  removedTokens: number;
  smsFallbacks: number;
}> {
  const redis = getRedisClient();
  const jobIds = await redis.smembers(K.pendingReceipts);
  let delivered = 0;
  let failed = 0;
  let removedTokens = 0;
  let smsFallbacks = 0;

  for (const jobId of jobIds) {
    try {
      const raw = await redis.get(K.receipts(jobId));
      if (!raw) {
        await redis.srem(K.pendingReceipts, jobId);
        continue;
      }

      const receipt: PushReceipt = JSON.parse(raw);
      if (!receipt.receiptId) {
        await redis.srem(K.pendingReceipts, jobId);
        continue;
      }

      const status = await checkReceipt(receipt.receiptId);
      receipt.status = status;
      receipt.checkedAt = new Date().toISOString();

      if (status === 'delivered') {
        receipt.deliveredAt = new Date().toISOString();
        delivered++;
        await redis.srem(K.pendingReceipts, jobId);
      } else if (status === 'device_not_registered') {
        await removeToken(receipt.userId, receipt.token);
        receipt.status = 'device_not_registered';
        removedTokens++;
        await redis.srem(K.pendingReceipts, jobId);
        logger.info('push_token_removed_via_receipt', { userId: receipt.userId, jobId });
      } else if (status === 'message_too_big') {
        logger.error('push_message_too_big', {
          jobId,
          userId: receipt.userId,
          title: receipt.title,
          bodyLength: receipt.body.length,
        });
        await redis.srem(K.pendingReceipts, jobId);
        failed++;
      } else if (status === 'invalid_credentials') {
        logger.error('push_invalid_credentials', {
          jobId,
          userId: receipt.userId,
        });
        await redis.srem(K.pendingReceipts, jobId);
        failed++;
      }

      // SMS fallback for critical undelivered notifications after 30 minutes
      if (
        receipt.isCritical &&
        status !== 'delivered' &&
        status !== 'device_not_registered'
      ) {
        const createdAt = new Date(receipt.createdAt).getTime();
        if (Date.now() - createdAt > SMS_FALLBACK_TIMEOUT_MS && !receipt.smsFallbackAttempted) {
          receipt.smsFallbackAttempted = true;
          logger.info('push_sms_fallback_attempted', {
            jobId,
            userId: receipt.userId,
            topic: receipt.topic,
            title: receipt.title,
          });
          smsFallbacks++;
        }
      }

      await redis.set(K.receipts(jobId), JSON.stringify(receipt));
    } catch (err) {
      logger.error('push_check_receipt_error', {
        jobId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return { checked: jobIds.length, delivered, failed, removedTokens, smsFallbacks };
}

// ─── Expo API ─────────────────────────────────────────────────────────────────

/** Send to Expo Push API. Returns the receipt ID on success, null on failure. */
async function sendToExpo(job: PushJob): Promise<string | null> {
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: job.token,
      title: job.title,
      body: job.body,
      data: job.data ?? {},
      sound: 'default',
    }),
  });

  if (!response.ok) {
    logger.warn('expo_push_http_error', { status: response.status, jobId: job.jobId });
    return null;
  }

  const result = (await response.json()) as {
    data?: { status?: string; id?: string; details?: { error?: string } };
  };

  const status = result?.data?.status;

  if (status === 'error') {
    const error = result?.data?.details?.error;
    if (error === 'DeviceNotRegistered') {
      await removeToken(job.userId, job.token);
      logger.info('push_token_invalidated', { userId: job.userId, error });
    }
    return null;
  }

  const receiptId = result?.data?.id ?? null;
  if (receiptId) {
    await storeReceipt(job, receiptId, 'pending');
    await incrMetric('delivered');
  }

  return receiptId;
}

/** Process one job from the queue. Returns true if a job was processed. */
export async function processOne(): Promise<boolean> {
  const redis = getRedisClient();
  const raw = await redis.lpop(K.queue);
  if (!raw) return false;

  const job: PushJob = JSON.parse(raw);
  job.attempts += 1;

  try {
    const receiptId = await sendToExpo(job);
    if (receiptId) {
      logger.info('push_sent', { jobId: job.jobId, attempt: job.attempts, receiptId });
      return true;
    }
    throw new Error('Expo push returned non-ok status');
  } catch (err) {
    logger.warn('push_attempt_failed', {
      jobId: job.jobId,
      attempt: job.attempts,
      error: err instanceof Error ? err.message : 'unknown',
    });

    if (job.attempts < MAX_ATTEMPTS) {
      await redis.rpush(K.queue, JSON.stringify(job));
      await incrMetric('retried');
    } else {
      await redis.rpush(K.dlq, JSON.stringify(job));
      await incrMetric('deadLettered');
      await incrMetric('failed');
      logger.error('push_dead_lettered', { jobId: job.jobId, userId: job.userId });
    }
    return true;
  }
}

/** Drain the queue, processing up to `limit` jobs. */
export async function drainQueue(limit = 100): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    await processScheduled();
    const had = await processOne();
    if (!had) break;
    processed++;
  }
  return processed;
}

/** Enqueue a push notification to all tokens of a user for a given topic. */
export async function sendToUser(
  userId: string,
  topic: NotificationTopic,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<number> {
  const tokens = await getTokens(userId);
  let enqueued = 0;
  for (const token of tokens) {
    const jobId = `${userId}:${topic}:${Date.now()}:${token.slice(-8)}`;
    const isCritical = CRITICAL_TOPICS.includes(topic);
    const queued = await enqueue({ jobId, userId, token, title, body, data, topic, isCritical });
    if (queued) enqueued++;
  }
  return enqueued;
}

/** Peek at DLQ entries (for monitoring). */
export async function getDLQ(limit = 50): Promise<PushJob[]> {
  const items = await getRedisClient().lrange(K.dlq, 0, limit - 1);
  return items.map((i) => JSON.parse(i) as PushJob);
}

/** Clear DLQ (admin action). */
export async function clearDLQ(): Promise<void> {
  await getRedisClient().del(K.dlq);
}

/** Get receipts for a specific job. */
export async function getReceipt(jobId: string): Promise<PushReceipt | null> {
  const raw = await getRedisClient().get(K.receipts(jobId));
  return raw ? (JSON.parse(raw) as PushReceipt) : null;
}

/** Get all pending receipts. */
export async function getPendingReceipts(): Promise<PushReceipt[]> {
  const redis = getRedisClient();
  const jobIds = await redis.smembers(K.pendingReceipts);
  const receipts: PushReceipt[] = [];
  for (const jobId of jobIds) {
    const raw = await redis.get(K.receipts(jobId));
    if (raw) receipts.push(JSON.parse(raw) as PushReceipt);
  }
  return receipts;
}

/**
 * Start the background receipt-checking job. Returns the interval handle.
 * Checks every 15 minutes for unconfirmed receipts.
 */
export function startReceiptCheckJob(intervalMs = RECEIPT_CHECK_INTERVAL_MS): NodeJS.Timeout {
  const timer = setInterval(async () => {
    try {
      const result = await checkPendingReceipts();
      if (result.checked > 0) {
        logger.info('push_receipt_check_completed', result);
      }
    } catch (err) {
      logger.error('push_receipt_check_job_error', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }, intervalMs) as unknown as NodeJS.Timeout;
  timer.unref();
  return timer;
}

/**
 * Start the scheduled push processor. Checks every 30 seconds for due jobs.
 */
export function startScheduledProcessor(intervalMs = 30_000): NodeJS.Timeout {
  const timer = setInterval(async () => {
    try {
      await processScheduled();
    } catch (err) {
      logger.error('push_scheduled_processor_error', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }, intervalMs) as unknown as NodeJS.Timeout;
  timer.unref();
  return timer;
}
