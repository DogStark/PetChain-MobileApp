import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import config from '../../../config';
import { UserRole } from '../../../models/UserRole';
import { store } from '../../../server/store';
import apiKeyService from '../../../services/apiKeyService';
import apiKeysRouter from '../apiKeys';
import integrationsRouter from '../integrations';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api-keys', apiKeysRouter);
  app.use('/integrations', integrationsRouter);
  return app;
}

describe('API key management routes', () => {
  let app: express.Express;
  let adminToken: string;
  let ownerToken: string;

  beforeAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    apiKeyService.resetApiKeyStore();
    store.users.clear();
    store.pets.clear();

    store.users.set('admin-1', {
      id: 'admin-1',
      email: 'admin@test.com',
      name: 'Admin',
      role: UserRole.ADMIN,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
      twoFactorEnabled: true,
    });

    store.users.set('owner-1', {
      id: 'owner-1',
      email: 'owner@test.com',
      name: 'Owner',
      role: UserRole.OWNER,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
      twoFactorEnabled: false,
    });

    adminToken = jwt.sign(
      { sub: 'admin-1', email: 'admin@test.com', role: UserRole.ADMIN },
      config.app.jwtSecret,
    );
    ownerToken = jwt.sign(
      { sub: 'owner-1', email: 'owner@test.com', role: UserRole.OWNER },
      config.app.jwtSecret,
    );

    app = buildApp();
  });

  it('denies non-admin access', async () => {
    const res = await request(app).get('/api-keys').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });

  it('creates, lists, rotates, and revokes keys', async () => {
    const createRes = await request(app)
      .post('/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Partner', scopes: ['pets:read'] });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.secret).toMatch(/^pk_live_/);
    expect(createRes.body.data.key.name).toBe('Partner');

    const keyId = createRes.body.data.key.id;
    const plaintext = createRes.body.data.secret;

    const listRes = await request(app)
      .get('/api-keys')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].keyHash).toBeUndefined();

    const rotateRes = await request(app)
      .post(`/api-keys/${keyId}/rotate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.data.secret).not.toBe(plaintext);

    const revokeRes = await request(app)
      .delete(`/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.data.status).toBe('revoked');
  });

  it('integration endpoint accepts valid API key', async () => {
    const createRes = await request(app)
      .post('/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Integration', scopes: ['pets:read'] });

    const secret = createRes.body.data.secret;
    store.pets.set('pet-1', {
      id: 'pet-1',
      name: 'Buddy',
      species: 'dog',
      ownerId: 'owner-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app).get('/integrations/pets').set('X-Api-Key', secret);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Buddy');
  });
});
