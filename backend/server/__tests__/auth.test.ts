import jwt from 'jsonwebtoken';
import request from 'supertest';

import config from '../../config';
import { UserRole } from '../../models/UserRole';
import { createApp } from '../app';
import { store } from '../store';

const app = createApp();

describe('Authentication Middleware', () => {
  const secret = config.app.jwtSecret;
  let testUser: any;

  beforeEach(() => {
    // Reset store and add a test user
    store.users.clear();
    const id = 'user-1';
    testUser = {
      id,
      email: 'test@example.com',
      name: 'Test User',
      role: UserRole.OWNER,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
    };
    store.users.set(id, testUser);
  });

  it('should allow access with a valid token', async () => {
    const token = jwt.sign(
      { sub: testUser.id, email: testUser.email, role: testUser.role },
      secret,
    );

    const response = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(testUser.id);
  });

  it('should allow access with a valid mock token in development', async () => {
    const response = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer mock-${testUser.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(testUser.id);
  });

  it('should return 401 for missing Authorization header', async () => {
    const response = await request(app).get('/api/users/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 401 for invalid token', async () => {
    const response = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
  });

  it('should return 403 for insufficient roles', async () => {
    // Admin route
    const token = jwt.sign(
      { sub: testUser.id, email: testUser.email, role: UserRole.OWNER },
      secret,
    );

    const response = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('should allow admin access to admin routes', async () => {
    const adminId = 'admin-1';
    const adminUser = {
      ...testUser,
      id: adminId,
      role: UserRole.ADMIN,
    };
    store.users.set(adminId, adminUser);

    const token = jwt.sign({ sub: adminId, email: adminUser.email, role: UserRole.ADMIN }, secret);

    const response = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
