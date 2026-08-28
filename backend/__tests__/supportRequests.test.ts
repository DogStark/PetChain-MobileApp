import request from 'supertest';

import { UserRole } from '../models/UserRole';
import { createApp } from '../server/app';
import { store } from '../server/store';

const app = createApp();

describe('Support Requests', () => {
  beforeEach(() => {
    store.users.clear();
    store.users.set('admin-1', {
      id: 'admin-1',
      email: 'admin@test.com',
      name: 'Admin User',
      role: UserRole.ADMIN,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
      twoFactorEnabled: true,
    });
  });

  it('allows public users to submit a support request', async () => {
    const response = await request(app).post('/api/support-requests').send({
      name: 'Pet Parent',
      email: 'parent@example.com',
      subject: 'Need help with CSV export',
      message: 'The export button is not working for me.',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.subject).toBe('Need help with CSV export');
    expect(response.body.data.status).toBe('open');
  });

  it('allows admins to list and update support requests', async () => {
    const listBefore = await request(app)
      .get('/api/admin/support-requests')
      .set('Authorization', 'Bearer mock-admin-1');

    expect(listBefore.status).toBe(200);
    expect(Array.isArray(listBefore.body.data)).toBe(true);

    const ticketId = listBefore.body.data[0].id;
    const update = await request(app)
      .patch(`/api/admin/support-requests/${ticketId}`)
      .set('Authorization', 'Bearer mock-admin-1')
      .send({ status: 'resolved' });

    expect(update.status).toBe(200);
    expect(update.body.data.status).toBe('resolved');
    expect(update.body.data.resolvedAt).toBeDefined();
  });
});
