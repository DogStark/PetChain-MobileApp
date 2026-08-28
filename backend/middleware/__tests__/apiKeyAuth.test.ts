import express from 'express';
import request from 'supertest';

import apiKeyService from '../../services/apiKeyService';
import { authenticateApiKey } from '../apiKeyAuth';

describe('authenticateApiKey middleware', () => {
  let app: express.Express;
  let secret: string;

  beforeAll(() => {
    jest.useRealTimers();
  });

  beforeEach(async () => {
    apiKeyService.resetApiKeyStore();
    const created = await apiKeyService.createApiKey(
      { name: 'Middleware test', scopes: ['pets:read', 'search:read'] },
      'admin-1',
    );
    secret = created.secret;

    app = express();
    app.get('/protected', authenticateApiKey('pets:read'), (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/strict', authenticateApiKey('pets:write'), (_req, res) => {
      res.json({ ok: true });
    });
  });

  it('rejects requests without API key', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('API_KEY_REQUIRED');
  });

  it('accepts X-Api-Key header with valid scope', async () => {
    const res = await request(app).get('/protected').set('X-Api-Key', secret);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('accepts Authorization: ApiKey scheme', async () => {
    const res = await request(app).get('/protected').set('Authorization', `ApiKey ${secret}`);
    expect(res.status).toBe(200);
  });

  it('returns 403 when scope is insufficient', async () => {
    const res = await request(app).get('/strict').set('X-Api-Key', secret);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('records usage after request completes', async () => {
    await request(app).get('/protected').set('X-Api-Key', secret);
    const usage = apiKeyService.getUsageSummary();
    expect(usage.some((u) => u.endpoint === '/protected')).toBe(true);
  });

  it('returns 401 api_key_expired for expired keys', async () => {
    apiKeyService.resetApiKeyStore();
    const { secret: expiredSecret } = await apiKeyService.createApiKey(
      {
        name: 'Expired key',
        scopes: ['pets:read'],
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      'admin-1',
    );
    const res = await request(app).get('/protected').set('X-Api-Key', expiredSecret);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('API_KEY_EXPIRED');
  });
});
