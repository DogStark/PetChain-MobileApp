import { Router } from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import {
  deliverWebhookEvent,
  getWebhook,
  getWebhookDeliveries,
  listWebhooks,
  registerWebhook,
} from '../../services/messagingService';
import { ok, sendError } from '../../server/response';

const router = Router();
router.use(authenticateJWT);

// POST /api/webhooks — register a webhook for the authenticated user
router.post('/', (req: AuthenticatedRequest, res) => {
  const { url, secret, events } = req.body as {
    url?: string;
    secret?: string;
    events?: string[];
  };
  if (!url || typeof url !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'url is required');
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'url must be an http(s) URL');
    }
  } catch {
    return sendError(res, 400, 'VALIDATION_ERROR', 'url must be a valid URL');
  }
  if (events !== undefined && (!Array.isArray(events) || events.some((e) => typeof e !== 'string'))) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'events must be an array of strings');
  }

  const webhook = registerWebhook({ ownerId: req.user!.id, url, secret, events });
  return res.status(201).json(ok(webhook));
});

// GET /api/webhooks — list the authenticated user's webhooks
router.get('/', (req: AuthenticatedRequest, res) => {
  return res.json(ok(listWebhooks(req.user!.id)));
});

// GET /api/webhooks/:id/deliveries — delivery history (status code + latency)
router.get('/:id/deliveries', (req: AuthenticatedRequest, res) => {
  const webhook = getWebhook(req.params.id);
  if (!webhook || webhook.ownerId !== req.user!.id) {
    return sendError(res, 404, 'NOT_FOUND', 'Webhook not found');
  }
  const limitParam = Number.parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;
  return res.json(ok(getWebhookDeliveries(webhook.id, limit)));
});

// POST /api/webhooks/:id/test — enqueue a test event for delivery
router.post('/:id/test', async (req: AuthenticatedRequest, res) => {
  const webhook = getWebhook(req.params.id);
  if (!webhook || webhook.ownerId !== req.user!.id) {
    return sendError(res, 404, 'NOT_FOUND', 'Webhook not found');
  }
  if (!webhook.active) {
    return sendError(res, 409, 'WEBHOOK_DISABLED', 'Webhook is disabled');
  }
  const delivery = await deliverWebhookEvent(webhook.id, 'webhook.test', {
    webhookId: webhook.id,
    sentAt: new Date().toISOString(),
  });
  return res.status(202).json(ok(delivery));
});

export default router;
