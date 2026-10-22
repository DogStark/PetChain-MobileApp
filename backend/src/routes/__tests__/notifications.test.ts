import request from 'supertest';

import { UserRole } from '../../../models/UserRole';
import { createApp } from '../../app';
import { store } from '../../store';

// ─── Mock pushService ─────────────────────────────────────────────────────────

jest.mock('../../../services/pushService', () => ({
  ALL_TOPICS: ['medication_reminders', 'appointment_alerts', 'sos_notifications', 'health_tips'],
  registerToken: jest.fn().mockResolvedValue(undefined),
  removeToken: jest.fn().mockResolvedValue(undefined),
  removeAllTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue(['ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]']),
  subscribe: jest.fn().mockResolvedValue(undefined),
  unsubscribe: jest.fn().mockResolvedValue(undefined),
  getSubscriptions: jest.fn().mockResolvedValue(['medication_reminders']),
  isSubscribed: jest.fn().mockResolvedValue(true),
  getPreferences: jest
    .fn()
    .mockResolvedValue({ enabled: true, topics: { medication_reminders: true } }),
  setPreferences: jest.fn().mockResolvedValue(undefined),
  sendToUser: jest.fn().mockResolvedValue(2),
  getMetrics: jest
    .fn()
    .mockResolvedValue({ queued: 5, delivered: 4, failed: 1, retried: 1, deadLettered: 1 }),
  getDLQ: jest.fn().mockResolvedValue([]),
  clearDLQ: jest.fn().mockResolvedValue(undefined),
}));

// ─── Setup ────────────────────────────────────────────────────────────────────

const app = createApp();

const OWNER_ID = 'notif-owner-1';
const ADMIN_ID = 'notif-admin-1';

function auth(userId: string) {
  return { Authorization: `Bearer mock-${userId}` };
}

beforeEach(() => {
  store.users.clear();
  store.users.set(OWNER_ID, {
    id: OWNER_ID,
    email: 'owner@test.com',
    name: 'Owner',
    role: UserRole.OWNER,
    pets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isEmailVerified: true,
    twoFactorEnabled: false,
  });
  store.users.set(ADMIN_ID, {
    id: ADMIN_ID,
    email: 'admin@test.com',
    name: 'Admin',
    role: UserRole.ADMIN,
    pets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isEmailVerified: true,
    twoFactorEnabled: true,
  });
});

// ─── Token registration ───────────────────────────────────────────────────────

describe('POST /api/notifications/tokens', () => {
  it('registers a valid token', async () => {
    const res = await request(app)
      .post('/api/notifications/tokens')
      .set(auth(OWNER_ID))
      .send({ token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('rejects missing token', async () => {
    const res = await request(app).post('/api/notifications/tokens').set(auth(OWNER_ID)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/notifications/tokens')
      .send({ token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid token format (from service)', async () => {
    const { registerToken } = require('../../../services/pushService');
    registerToken.mockRejectedValueOnce(new Error('Invalid Expo push token format'));
    const res = await request(app)
      .post('/api/notifications/tokens')
      .set(auth(OWNER_ID))
      .send({ token: 'bad-token' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/notifications/tokens', () => {
  it('returns masked token list', async () => {
    const res = await request(app).get('/api/notifications/tokens').set(auth(OWNER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.tokens[0].prefix).toBeDefined();
    // Full token must not be exposed
    expect(JSON.stringify(res.body)).not.toContain('aaaaaaaaaaaaaaaaaaaaaa');
  });
});

describe('DELETE /api/notifications/tokens', () => {
  it('removes a specific token', async () => {
    const res = await request(app)
      .delete('/api/notifications/tokens')
      .set(auth(OWNER_ID))
      .send({ token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' });
    expect(res.status).toBe(200);
  });

  it('rejects missing token', async () => {
    const res = await request(app).delete('/api/notifications/tokens').set(auth(OWNER_ID)).send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/notifications/tokens/all', () => {
  it('removes all tokens', async () => {
    const res = await request(app).delete('/api/notifications/tokens/all').set(auth(OWNER_ID));
    expect(res.status).toBe(200);
  });
});

// ─── Subscriptions ────────────────────────────────────────────────────────────

describe('GET /api/notifications/subscriptions', () => {
  it('returns subscriptions and available topics', async () => {
    const res = await request(app).get('/api/notifications/subscriptions').set(auth(OWNER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.subscriptions).toContain('medication_reminders');
    expect(res.body.data.available).toHaveLength(4);
  });
});

describe('PUT /api/notifications/subscriptions/:topic', () => {
  it('subscribes to a valid topic', async () => {
    const res = await request(app)
      .put('/api/notifications/subscriptions/appointment_alerts')
      .set(auth(OWNER_ID));
    expect(res.status).toBe(200);
  });

  it('rejects unknown topic', async () => {
    const res = await request(app)
      .put('/api/notifications/subscriptions/unknown_topic')
      .set(auth(OWNER_ID));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/notifications/subscriptions/:topic', () => {
  it('unsubscribes from a topic', async () => {
    const res = await request(app)
      .delete('/api/notifications/subscriptions/medication_reminders')
      .set(auth(OWNER_ID));
    expect(res.status).toBe(200);
  });

  it('rejects unknown topic', async () => {
    const res = await request(app)
      .delete('/api/notifications/subscriptions/bad_topic')
      .set(auth(OWNER_ID));
    expect(res.status).toBe(400);
  });
});

// ─── Preferences ──────────────────────────────────────────────────────────────

describe('GET /api/notifications/preferences', () => {
  it('returns preferences', async () => {
    const res = await request(app).get('/api/notifications/preferences').set(auth(OWNER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
  });
});

describe('PATCH /api/notifications/preferences', () => {
  it('updates enabled flag', async () => {
    const res = await request(app)
      .patch('/api/notifications/preferences')
      .set(auth(OWNER_ID))
      .send({ enabled: false });
    expect(res.status).toBe(200);
  });

  it('rejects non-boolean enabled', async () => {
    const res = await request(app)
      .patch('/api/notifications/preferences')
      .set(auth(OWNER_ID))
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown topic in topics map', async () => {
    const res = await request(app)
      .patch('/api/notifications/preferences')
      .set(auth(OWNER_ID))
      .send({ topics: { unknown_topic: true } });
    expect(res.status).toBe(400);
  });

  it('updates topic-level preference', async () => {
    const res = await request(app)
      .patch('/api/notifications/preferences')
      .set(auth(OWNER_ID))
      .send({ topics: { health_tips: false } });
    expect(res.status).toBe(200);
  });
});

// ─── Admin: send ──────────────────────────────────────────────────────────────

describe('POST /api/notifications/send', () => {
  it('sends notification as admin', async () => {
    const res = await request(app)
      .post('/api/notifications/send')
      .set(auth(ADMIN_ID))
      .send({ userId: OWNER_ID, topic: 'medication_reminders', title: 'Hi', body: 'Test' });
    expect(res.status).toBe(200);
    expect(res.body.data.enqueued).toBe(2);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/notifications/send')
      .set(auth(OWNER_ID))
      .send({ userId: OWNER_ID, topic: 'medication_reminders', title: 'Hi', body: 'Test' });
    expect(res.status).toBe(403);
  });

  it('validates required fields', async () => {
    const res = await request(app)
      .post('/api/notifications/send')
      .set(auth(ADMIN_ID))
      .send({ topic: 'medication_reminders', title: 'Hi', body: 'Test' }); // missing userId
    expect(res.status).toBe(400);
  });

  it('rejects invalid topic', async () => {
    const res = await request(app)
      .post('/api/notifications/send')
      .set(auth(ADMIN_ID))
      .send({ userId: OWNER_ID, topic: 'bad_topic', title: 'Hi', body: 'Test' });
    expect(res.status).toBe(400);
  });
});

// ─── Admin: metrics & DLQ ─────────────────────────────────────────────────────

describe('GET /api/notifications/metrics', () => {
  it('returns metrics for admin', async () => {
    const res = await request(app).get('/api/notifications/metrics').set(auth(ADMIN_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.queued).toBe(5);
    expect(res.body.data.delivered).toBe(4);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app).get('/api/notifications/metrics').set(auth(OWNER_ID));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/notifications/dlq', () => {
  it('returns DLQ for admin', async () => {
    const res = await request(app).get('/api/notifications/dlq').set(auth(ADMIN_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toBeDefined();
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app).get('/api/notifications/dlq').set(auth(OWNER_ID));
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/notifications/dlq', () => {
  it('clears DLQ for admin', async () => {
    const res = await request(app).delete('/api/notifications/dlq').set(auth(ADMIN_ID));
    expect(res.status).toBe(200);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app).delete('/api/notifications/dlq').set(auth(OWNER_ID));
    expect(res.status).toBe(403);
  });
});
