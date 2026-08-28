import jwt from 'jsonwebtoken';
import request from 'supertest';

import config from '../config';
import { UserRole } from '../models/UserRole';
import { createApp } from '../server';
import { store } from '../server/store';

const app = createApp(undefined);
const secret = config.app.jwtSecret;

describe('Admin user management', () => {
  const adminId = 'admin-user';
  const ownerId = 'owner-user';
  let adminToken: string;

  beforeEach(() => {
    store.users.clear();
    store.users.set(adminId, {
      id: adminId,
      email: 'admin@petchain.app',
      name: 'Admin',
      role: UserRole.ADMIN,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
      twoFactorEnabled: true,
    });
    store.users.set(ownerId, {
      id: ownerId,
      email: 'owner@petchain.app',
      name: 'Owner',
      role: UserRole.OWNER,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
      twoFactorEnabled: false,
    });

    adminToken = jwt.sign(
      { sub: adminId, email: 'admin@petchain.app', role: UserRole.ADMIN },
      secret,
    );
  });

  it('lists users for admins', async () => {
    const response = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
  });

  it('searches users by email', async () => {
    const response = await request(app)
      .get('/admin/users?search=owner')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(ownerId);
  });

  it('soft-deletes users instead of removing them', async () => {
    const response = await request(app)
      .delete(`/admin/users/${ownerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(store.users.get(ownerId)?.deletedAt).toBeDefined();

    const listResponse = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listResponse.body.data).toHaveLength(1);
  });

  it('exports analytics as CSV', async () => {
    const response = await request(app)
      .get('/admin/analytics/export.csv')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('active_users_7d');
  });
});
