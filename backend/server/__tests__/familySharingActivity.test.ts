import express from 'express';
import request from 'supertest';

import { PetAccessLevel } from '../../models/FamilySharing';
import { UserRole } from '../../models/UserRole';
import familySharingService from '../../services/familySharingService';
import familySharingRouter from '../routes/familySharing';
import { store } from '../store';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    call: jest.fn().mockResolvedValue(null),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
  }));
});

describe('GET /api/family-sharing/:grantId/activity', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/family-sharing', familySharingRouter);

  const ownerId = 'owner-grant-1';
  const coOwnerId = 'co-owner-grant-2';
  const strangerId = 'stranger-grant-3';

  beforeEach(() => {
    store.users.clear();
    const now = new Date().toISOString();
    for (const [id, role] of [
      [ownerId, UserRole.OWNER],
      [coOwnerId, UserRole.OWNER],
      [strangerId, UserRole.OWNER],
    ] as const) {
      store.users.set(id, {
        id,
        email: `${id}@test.com`,
        name: id,
        role,
        pets: [],
        createdAt: now,
        updatedAt: now,
        isEmailVerified: true,
      });
    }
  });

  it('returns paginated shared-access activity with acting_user_id and on_behalf_of_user_id', async () => {
    const grant = familySharingService.grantPetAccess('pet-shared-1', ownerId, {
      userId: coOwnerId,
      permissionLevel: PetAccessLevel.CAREGIVER,
    });

    for (let i = 0; i < 3; i++) {
      familySharingService.recordSharedAccessAction({
        grantId: grant.id,
        actingUserId: coOwnerId,
        action: 'pet.updated',
        description: `Co-owner update ${i}`,
      });
    }

    const forbidden = await request(app)
      .get(`/api/family-sharing/${grant.id}/activity`)
      .set('Authorization', `Bearer mock-${strangerId}`);
    expect(forbidden.status).toBe(403);

    const res = await request(app)
      .get(`/api/family-sharing/${grant.id}/activity?page=1&limit=2`)
      .set('Authorization', `Bearer mock-${ownerId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 4,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });

    const coOwnerActions = (
      res.body.data as Array<{
        action: string;
        acting_user_id?: string;
        on_behalf_of_user_id?: string;
      }>
    ).filter((item) => item.action === 'pet.updated');
    expect(coOwnerActions.length).toBeGreaterThanOrEqual(1);
    expect(coOwnerActions[0].acting_user_id).toBe(coOwnerId);
    expect(coOwnerActions[0].on_behalf_of_user_id).toBe(ownerId);
  });
});
