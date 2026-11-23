import { type IncomingMessage, type Server } from 'http';

import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer, type WebSocket } from 'ws';

import logger from '../utils/logger';

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content?: string;
  attachmentUrl?: string;
  attachmentType?: string;
  readAt?: string;
  createdAt: string;
}

// In-memory store (replace with DB queries in production)
const messages = new Map<string, Message[]>(); // conversationId -> messages
const clients = new Map<string, WebSocket>(); // userId -> ws

export function getConversationId(userA: string, userB: string): string {
  return [userA, userB].sort().join(':');
}

export function getMessages(conversationId: string, limit = 50, before?: string): Message[] {
  const all = messages.get(conversationId) ?? [];
  const filtered = before ? all.filter((m) => m.createdAt < before) : all;
  return filtered.slice(-limit);
}

export function saveMessage(msg: Omit<Message, 'id' | 'createdAt'>): Message {
  const saved: Message = { ...msg, id: uuidv4(), createdAt: new Date().toISOString() };
  const list = messages.get(saved.conversationId) ?? [];
  list.push(saved);
  messages.set(saved.conversationId, list);
  return saved;
}

export function markRead(conversationId: string, userId: string): void {
  const list = messages.get(conversationId) ?? [];
  const now = new Date().toISOString();
  list.forEach((m) => {
    if (m.recipientId === userId && !m.readAt) m.readAt = now;
  });
}

// ─── Webhook delivery with exponential backoff ────────────────────────────────

export const WEBHOOK_MAX_ATTEMPTS = 10;
export const WEBHOOK_BASE_DELAY_MS = 1000;
export const WEBHOOK_MAX_DELAY_MS = 60 * 60 * 1000; // 1 hour
export const WEBHOOK_TIMEOUT_MS = 10_000;

export interface Webhook {
  id: string;
  ownerId: string;
  url: string;
  secret?: string;
  events: string[];
  active: boolean;
  disabledAt?: string;
  disabledReason?: string;
  createdAt: string;
}

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed';

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: unknown;
  attempt: number;
  status: WebhookDeliveryStatus;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
  scheduledAt: string;
  createdAt: string;
  completedAt?: string;
}

export interface WebhookDeliveryOptions {
  /** Override the HTTP sender (used by tests). */
  sender?: (webhook: Webhook, delivery: WebhookDelivery) => Promise<WebhookSendResult>;
  /** Override the owner notification hook (used by tests). */
  notifier?: (webhook: Webhook, delivery: WebhookDelivery) => Promise<void> | void;
}

export interface WebhookSendResult {
  statusCode: number;
  latencyMs: number;
  error?: string;
}

const webhooks = new Map<string, Webhook>();
const deliveries = new Map<string, WebhookDelivery[]>(); // webhookId -> deliveries
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>(); // deliveryId -> timer

/** Delay before the given attempt (1-based): 1s, 2s, 4s… capped at 1h. */
export function computeBackoffDelay(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(WEBHOOK_BASE_DELAY_MS * 2 ** exponent, WEBHOOK_MAX_DELAY_MS);
}

export function registerWebhook(input: {
  ownerId: string;
  url: string;
  secret?: string;
  events?: string[];
}): Webhook {
  const webhook: Webhook = {
    id: uuidv4(),
    ownerId: input.ownerId,
    url: input.url,
    secret: input.secret,
    events: input.events ?? ['*'],
    active: true,
    createdAt: new Date().toISOString(),
  };
  webhooks.set(webhook.id, webhook);
  deliveries.set(webhook.id, []);
  return webhook;
}

export function getWebhook(id: string): Webhook | undefined {
  return webhooks.get(id);
}

export function listWebhooks(ownerId: string): Webhook[] {
  return [...webhooks.values()].filter((w) => w.ownerId === ownerId);
}

export function getWebhookDeliveries(webhookId: string, limit = 50): WebhookDelivery[] {
  const list = deliveries.get(webhookId) ?? [];
  return list.slice(-limit).reverse();
}

export function clearWebhookState(): void {
  pendingTimers.forEach((timer) => clearTimeout(timer));
  pendingTimers.clear();
  webhooks.clear();
  deliveries.clear();
}

async function defaultSender(webhook: Webhook, delivery: WebhookDelivery): Promise<WebhookSendResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-petchain-event': delivery.event,
        'x-petchain-delivery': delivery.id,
        ...(webhook.secret ? { 'x-petchain-signature': webhook.secret } : {}),
      },
      body: JSON.stringify(delivery.payload),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    if (response.status >= 200 && response.status < 300) {
      return { statusCode: response.status, latencyMs };
    }
    return { statusCode: response.status, latencyMs, error: `HTTP ${response.status}` };
  } catch (error) {
    return {
      statusCode: 0,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Unknown delivery error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultNotifier(webhook: Webhook, delivery: WebhookDelivery): Promise<void> {
  logger.warn('Webhook disabled after repeated delivery failures', {
    webhookId: webhook.id,
    ownerId: webhook.ownerId,
    deliveryId: delivery.id,
    attempts: delivery.attempt,
  });
}

function recordDelivery(delivery: WebhookDelivery): void {
  const list = deliveries.get(delivery.webhookId) ?? [];
  const index = list.findIndex((d) => d.id === delivery.id);
  if (index >= 0) list[index] = delivery;
  else list.push(delivery);
  deliveries.set(delivery.webhookId, list);
}

async function attemptDelivery(
  webhook: Webhook,
  delivery: WebhookDelivery,
  options: WebhookDeliveryOptions,
): Promise<WebhookDelivery> {
  const sender = options.sender ?? defaultSender;
  const notifier = options.notifier ?? defaultNotifier;

  delivery.attempt += 1;
  delivery.status = 'pending';
  delivery.scheduledAt = new Date().toISOString();
  recordDelivery(delivery);

  const result = await sender(webhook, delivery);
  delivery.statusCode = result.statusCode;
  delivery.latencyMs = result.latencyMs;
  delivery.completedAt = new Date().toISOString();

  if (!result.error) {
    delivery.status = 'success';
    delivery.error = undefined;
    recordDelivery(delivery);
    return delivery;
  }

  delivery.error = result.error;
  if (delivery.attempt >= WEBHOOK_MAX_ATTEMPTS) {
    delivery.status = 'failed';
    recordDelivery(delivery);
    webhook.active = false;
    webhook.disabledAt = new Date().toISOString();
    webhook.disabledReason = `Disabled after ${delivery.attempt} failed delivery attempts`;
    await notifier(webhook, delivery);
    return delivery;
  }

  delivery.status = 'pending';
  const delay = computeBackoffDelay(delivery.attempt);
  delivery.scheduledAt = new Date(Date.now() + delay).toISOString();
  recordDelivery(delivery);

  const timer = setTimeout(() => {
    pendingTimers.delete(delivery.id);
    void attemptDelivery(webhook, delivery, options);
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  pendingTimers.set(delivery.id, timer);

  return delivery;
}

/**
 * Queue a webhook event for delivery. The first attempt runs immediately; failures are
 * retried with exponential backoff until the webhook succeeds or is disabled.
 */
export async function deliverWebhookEvent(
  webhookId: string,
  event: string,
  payload: unknown,
  options: WebhookDeliveryOptions = {},
): Promise<WebhookDelivery | null> {
  const webhook = webhooks.get(webhookId);
  if (!webhook || !webhook.active) return null;
  if (!webhook.events.includes('*') && !webhook.events.includes(event)) return null;

  const delivery: WebhookDelivery = {
    id: uuidv4(),
    webhookId,
    event,
    payload,
    attempt: 0,
    status: 'pending',
    scheduledAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  recordDelivery(delivery);
  return attemptDelivery(webhook, delivery, options);
}

export function attachWebSocketServer(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws/messages' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const userId = url.searchParams.get('userId');
    if (!userId) {
      ws.close(4001, 'userId required');
      return;
    }

    clients.set(userId, ws);

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as {
          recipientId: string;
          content?: string;
          attachmentUrl?: string;
          attachmentType?: string;
        };
        const conversationId = getConversationId(userId, data.recipientId);
        const msg = saveMessage({ conversationId, senderId: userId, ...data });

        // Deliver to recipient if online
        const recipientWs = clients.get(data.recipientId);
        if (recipientWs?.readyState === 1) {
          recipientWs.send(JSON.stringify(msg));
        }
        ws.send(JSON.stringify(msg));
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => clients.delete(userId));
  });
}
