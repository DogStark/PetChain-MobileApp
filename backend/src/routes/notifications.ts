import { randomUUID } from 'crypto';

import express from 'express';

import { authenticateJWT, authorizeRoles, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import { sendNotification } from '../../services/notificationTemplateService';
import { ok, sendError } from '../../server/response';
import {
  ALL_TOPICS,
  type NotificationTopic,
  clearDLQ,
  getDLQ,
  getMetrics,
  getPendingReceipts,
  getPreferences,
  getReceipt,
  getSubscriptions,
  getTokens,
  getUserTimezone,
  registerToken,
  removeAllTokens,
  removeToken,
  rescheduleForTimezoneChange,
  scheduleAtLocalTime,
  sendToUser,
  setPreferences,
  setUserTimezone,
  subscribe,
  unsubscribe,
} from '../../services/pushService';
import logger from '../../utils/logger';

const router = express.Router();
router.use(authenticateJWT);

// ─── Device token registration ────────────────────────────────────────────────

/** POST /api/notifications/tokens — register a push token */
router.post('/tokens', async (req: AuthenticatedRequest, res) => {
  const { token } = req.body as { token?: string };
  if (!token?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'token is required');

  try {
    await registerToken(req.user!.id, token.trim());
    logger.info('device_token_registered', { userId: req.user!.id });
    return res.status(201).json(ok(null, 'Token registered'));
  } catch (err) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      err instanceof Error ? err.message : 'Invalid token',
    );
  }
});

/** GET /api/notifications/tokens — list registered tokens for current user */
router.get('/tokens', async (req: AuthenticatedRequest, res) => {
  const tokens = await getTokens(req.user!.id);
  // Never expose full tokens in list — return count + masked prefixes
  const masked = tokens.map((t) => ({ prefix: t.slice(0, 22) + '…' }));
  return res.json(ok({ count: tokens.length, tokens: masked }));
});

/** DELETE /api/notifications/tokens — remove a specific token */
router.delete('/tokens', async (req: AuthenticatedRequest, res) => {
  const { token } = req.body as { token?: string };
  if (!token?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'token is required');
  await removeToken(req.user!.id, token.trim());
  return res.json(ok(null, 'Token removed'));
});

/** DELETE /api/notifications/tokens/all — remove all tokens (logout) */
router.delete('/tokens/all', async (req: AuthenticatedRequest, res) => {
  await removeAllTokens(req.user!.id);
  return res.json(ok(null, 'All tokens removed'));
});

// ─── Topic subscriptions ──────────────────────────────────────────────────────

/** GET /api/notifications/subscriptions */
router.get('/subscriptions', async (req: AuthenticatedRequest, res) => {
  const subs = await getSubscriptions(req.user!.id);
  return res.json(ok({ subscriptions: subs, available: ALL_TOPICS }));
});

/** PUT /api/notifications/subscriptions/:topic */
router.put('/subscriptions/:topic', async (req: AuthenticatedRequest, res) => {
  const topic = req.params.topic as NotificationTopic;
  if (!ALL_TOPICS.includes(topic)) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      `Unknown topic. Valid: ${ALL_TOPICS.join(', ')}`,
    );
  }
  await subscribe(req.user!.id, topic);
  return res.json(ok(null, `Subscribed to ${topic}`));
});

/** DELETE /api/notifications/subscriptions/:topic */
router.delete('/subscriptions/:topic', async (req: AuthenticatedRequest, res) => {
  const topic = req.params.topic as NotificationTopic;
  if (!ALL_TOPICS.includes(topic)) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      `Unknown topic. Valid: ${ALL_TOPICS.join(', ')}`,
    );
  }
  await unsubscribe(req.user!.id, topic);
  return res.json(ok(null, `Unsubscribed from ${topic}`));
});

// ─── Preferences ──────────────────────────────────────────────────────────────

/** GET /api/notifications/preferences */
router.get('/preferences', async (req: AuthenticatedRequest, res) => {
  const prefs = await getPreferences(req.user!.id);
  return res.json(ok(prefs));
});

/** PATCH /api/notifications/preferences */
router.patch('/preferences', async (req: AuthenticatedRequest, res) => {
  const body = req.body as {
    enabled?: boolean;
    topics?: Partial<Record<NotificationTopic, boolean>>;
  };

  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'enabled must be a boolean');
  }
  if (body.topics) {
    for (const key of Object.keys(body.topics)) {
      if (!ALL_TOPICS.includes(key as NotificationTopic)) {
        return sendError(res, 400, 'VALIDATION_ERROR', `Unknown topic: ${key}`);
      }
    }
  }

  await setPreferences(req.user!.id, body);
  const updated = await getPreferences(req.user!.id);
  return res.json(ok(updated));
});

// ─── Send (internal / admin) ──────────────────────────────────────────────────

/**
 * POST /api/notifications/send — send a push to a user (admin only)
 *
 * NOTE: title/body are admin-authored free text, not a template key, so this
 * route intentionally bypasses sendNotification()/template locale resolution
 * and calls pushService.sendToUser() directly, same as before.
 */
router.post('/send', authorizeRoles(UserRole.ADMIN), async (req: AuthenticatedRequest, res) => {
  const { userId, topic, title, body, data } = req.body as {
    userId?: string;
    topic?: string;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
  };

  if (!userId?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'userId is required');
  if (!topic || !ALL_TOPICS.includes(topic as NotificationTopic)) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      `topic must be one of: ${ALL_TOPICS.join(', ')}`,
    );
  }
  if (!title?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'title is required');
  if (!body?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'body is required');

  const enqueued = await sendToUser(
    userId.trim(),
    topic as NotificationTopic,
    title.trim(),
    body.trim(),
    data,
  );
  return res.json(ok({ enqueued }));
});

// ─── Metrics (admin) ──────────────────────────────────────────────────────────

/** GET /api/notifications/metrics */
router.get('/metrics', authorizeRoles(UserRole.ADMIN), async (_req, res) => {
  const metrics = await getMetrics();
  return res.json(ok(metrics));
});

/** GET /api/notifications/dlq */
router.get('/dlq', authorizeRoles(UserRole.ADMIN), async (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50'), 200);
  const items = await getDLQ(limit);
  return res.json(ok({ count: items.length, items }));
});

/** DELETE /api/notifications/dlq */
router.delete('/dlq', authorizeRoles(UserRole.ADMIN), async (_req, res) => {
  await clearDLQ();
  return res.json(ok(null, 'DLQ cleared'));
});

// ─── Timezone management ──────────────────────────────────────────────────────

/** GET /api/notifications/timezone — get user's timezone */
router.get('/timezone', async (req: AuthenticatedRequest, res) => {
  const timezone = await getUserTimezone(req.user!.id);
  return res.json(ok({ timezone }));
});

/** PUT /api/notifications/timezone — update user's timezone and reschedule pending notifications */
router.put('/timezone', async (req: AuthenticatedRequest, res) => {
  const { timezone } = req.body as { timezone?: string };
  if (!timezone?.trim()) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'timezone is required (IANA timezone string, e.g. Asia/Tokyo)',
    );
  }
  try {
    await rescheduleForTimezoneChange(req.user!.id, timezone.trim());
    return res.json(
      ok({ timezone: timezone.trim() }, 'Timezone updated and notifications rescheduled'),
    );
  } catch (err) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      err instanceof Error ? err.message : 'Invalid timezone',
    );
  }
});

/** POST /api/notifications/schedule — schedule a push notification at a local time */
router.post('/schedule', async (req: AuthenticatedRequest, res) => {
  const { topic, title, body, localDate, localTime, timezone, data } = req.body as {
    topic?: string;
    title?: string;
    body?: string;
    localDate?: string;
    localTime?: string;
    timezone?: string;
    data?: Record<string, unknown>;
  };

  if (!topic || !ALL_TOPICS.includes(topic as NotificationTopic)) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      `topic must be one of: ${ALL_TOPICS.join(', ')}`,
    );
  }
  if (!title?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'title is required');
  if (!body?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'body is required');
  if (!localDate?.trim())
    return sendError(res, 400, 'VALIDATION_ERROR', 'localDate is required (YYYY-MM-DD)');
  if (!localTime?.trim())
    return sendError(res, 400, 'VALIDATION_ERROR', 'localTime is required (HH:MM)');

  const utcDate = await scheduleAtLocalTime(
    req.user!.id,
    topic as NotificationTopic,
    title.trim(),
    body.trim(),
    localDate.trim(),
    localTime.trim(),
    timezone?.trim(),
    data,
  );

  if (!utcDate) {
    return sendError(res, 500, 'SCHEDULE_ERROR', 'Failed to schedule notification');
  }

  return res.status(201).json(ok({ scheduledUtcTime: utcDate.toISOString() }));
});

// ─── Receipt tracking (admin) ──────────────────────────────────────────────────

/** GET /api/notifications/receipts — list pending receipts (admin) */
router.get('/receipts', authorizeRoles(UserRole.ADMIN), async (_req, res) => {
  const receipts = await getPendingReceipts();
  return res.json(ok({ count: receipts.length, receipts }));
});

/** GET /api/notifications/receipts/:jobId — get a specific receipt (admin) */
router.get('/receipts/:jobId', authorizeRoles(UserRole.ADMIN), async (req, res) => {
  const receipt = await getReceipt(req.params.jobId);
  if (!receipt) return sendError(res, 404, 'NOT_FOUND', 'Receipt not found');
  return res.json(ok(receipt));
});

// ─── Vaccination notification transfer ───────────────────────────────────────

/**
 * POST /api/notifications/vaccination-transfer
 * Called when a pet changes owner. Sends a push to the new owner asking their
 * device to load and schedule local vaccination reminders for the transferred pet.
 */
router.post('/vaccination-transfer', async (req: AuthenticatedRequest, res) => {
  const { petId, newOwnerUserId } = req.body as {
    petId?: string;
    newOwnerUserId?: string;
  };

  if (!petId?.trim() || !newOwnerUserId?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'petId and newOwnerUserId are required');
  }

  const pet = require('../../server/store').store.pets.get(petId.trim());
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');

  // Only the current owner or admin may trigger this transfer
  if (req.user!.role !== UserRole.ADMIN && req.user!.id !== pet.ownerId) {
    return sendError(
      res,
      403,
      'FORBIDDEN',
      'You do not have permission to transfer notifications for this pet',
    );
  }

  await sendNotification(
    newOwnerUserId.trim(),
    'vaccination_transfer',
    { petName: pet.name },
    {
      topic: 'health_tips' as NotificationTopic, // closest available topic for health-related push
      data: { type: 'vaccination_transfer', petId: petId.trim() },
    },
  );

  logger.info('vaccination_notifications_transferred', {
    petId: petId.trim(),
    fromUserId: req.user!.id,
    toUserId: newOwnerUserId.trim(),
  });

  return res.json(ok(null, 'Vaccination notifications transferred'));
});

export default router;
