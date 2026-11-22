import request from 'supertest';

import { UserRole } from '../../models/UserRole';
import { store } from '../store';

jest.mock(
  '@elastic/elasticsearch',
  () => ({
    Client: jest.fn().mockImplementation(() => ({
      search: jest.fn(),
      index: jest.fn(),
    })),
  }),
  { virtual: true },
);

jest.mock(
  'multer',
  () => {
    const fn = (() => ({
      single: () => (_req: any, _res: any, next: any) => next(),
    })) as any;
    fn.memoryStorage = () => ({});
    return fn;
  },
  { virtual: true },
);

jest.mock('../../src/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ total: 0 }], rowCount: 0 }),
}));

jest.mock('../../src/repositories/petRepository', () => ({
  petRepository: {
    create: jest.fn(),
    findById: jest.fn(),
    findAll: jest.fn(),
    findByOwnerId: jest.fn(),
  },
}));

jest.mock('../../src/repositories/userRepository', () => ({
  userRepository: {
    findById: jest.fn(),
    findByEmail: jest.fn().mockResolvedValue(null),
  },
}));

const { query } = jest.requireMock('../../src/db') as { query: jest.Mock };

function seedUser(id: string, email: string, role = UserRole.OWNER) {
  const now = new Date().toISOString();
  store.users.set(id, {
    id,
    email,
    name: id,
    role,
    pets: [],
    createdAt: now,
    updatedAt: now,
    isEmailVerified: true,
    twoFactorEnabled: false,
  });
}

function auditInserts() {
  return query.mock.calls.filter(
    (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO audit_trail'),
  );
}

describe('Pet joint ownership API (#1388)', () => {
  const { createApp } = require('../app') as typeof import('../app');
  const app = createApp();
  const ownerId = 'owner-1';
  const coOwnerId = 'co-owner-1';
  const strangerId = 'stranger-1';
  const petId = 'pet-joint-1';

  beforeEach(() => {
    query.mockClear();
    store.users.clear();
    store.pets.clear();
    store.petJointOwners.clear();

    seedUser(ownerId, 'owner@test.com');
    seedUser(coOwnerId, 'co@test.com');
    seedUser(strangerId, 'stranger@test.com');

    const now = new Date().toISOString();
    store.pets.set(petId, {
      id: petId,
      name: 'Buddy',
      species: 'dog',
      ownerId,
      createdAt: now,
      updatedAt: now,
    });
  });

  function addCoOwner(asUser = ownerId, email = 'co@test.com') {
    return request(app)
      .post(`/api/pets/${petId}/owners`)
      .set('Authorization', `Bearer mock-${asUser}`)
      .send({ email });
  }

  it('adds a joint owner by email and logs it in the audit trail', async () => {
    const res = await addCoOwner();

    expect(res.status).toBe(201);
    expect(res.body.data.jointOwners).toEqual([
      expect.objectContaining({ userId: coOwnerId, email: 'co@test.com' }),
    ]);
    expect(store.petJointOwners.has(`${petId}:${coOwnerId}`)).toBe(true);

    const inserts = auditInserts();
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    const params = inserts[inserts.length - 1][1] as any[];
    // params: [id, entityType, entityId, action, beforeData, afterData, changedBy, ip, ua]
    expect(params[1]).toBe('pet');
    expect(params[2]).toBe(petId);
    expect(params[3]).toBe('UPDATE');
    expect(params[6]).toBe(ownerId);
  });

  it('rejects adding an existing owner and unknown emails', async () => {
    await addCoOwner();
    expect((await addCoOwner()).status).toBe(409);
    expect((await addCoOwner(ownerId, 'owner@test.com')).status).toBe(409);
    expect((await addCoOwner(ownerId, 'nobody@test.com')).status).toBe(404);
    expect((await addCoOwner(ownerId, 'not-an-email')).status).toBe(400);
  });

  it('forbids non-owners from managing owners', async () => {
    const res = await addCoOwner(strangerId, 'stranger@test.com');
    expect(res.status).toBe(403);
    expect(store.petJointOwners.size).toBe(0);
  });

  it('gives joint owners the same rights on the pet as the primary owner', async () => {
    const before = await request(app)
      .get(`/api/pets/${petId}/medical-records`)
      .set('Authorization', `Bearer mock-${coOwnerId}`);
    expect(before.status).toBe(403);

    await addCoOwner();

    const records = await request(app)
      .get(`/api/pets/${petId}/medical-records`)
      .set('Authorization', `Bearer mock-${coOwnerId}`);
    expect(records.status).toBe(200);

    const qr = await request(app)
      .post(`/api/pets/${petId}/qr-identity`)
      .set('Authorization', `Bearer mock-${coOwnerId}`);
    expect(qr.status).toBe(201);

    // A joint owner can manage owners too.
    const add = await addCoOwner(coOwnerId, 'stranger@test.com');
    expect(add.status).toBe(201);
  });

  it('removes a joint owner and logs it in the audit trail', async () => {
    await addCoOwner();
    query.mockClear();

    const res = await request(app)
      .delete(`/api/pets/${petId}/owners/${coOwnerId}`)
      .set('Authorization', `Bearer mock-${ownerId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.jointOwners).toEqual([]);
    expect(store.petJointOwners.has(`${petId}:${coOwnerId}`)).toBe(false);

    const inserts = auditInserts();
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    const params = inserts[inserts.length - 1][1] as any[];
    expect(params[3]).toBe('UPDATE');
    expect(params[6]).toBe(ownerId);

    const records = await request(app)
      .get(`/api/pets/${petId}/medical-records`)
      .set('Authorization', `Bearer mock-${coOwnerId}`);
    expect(records.status).toBe(403);
  });

  it('prevents owners from removing themselves', async () => {
    await addCoOwner();

    const self = await request(app)
      .delete(`/api/pets/${petId}/owners/${coOwnerId}`)
      .set('Authorization', `Bearer mock-${coOwnerId}`);
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('SELF_REMOVAL');
    expect(store.petJointOwners.has(`${petId}:${coOwnerId}`)).toBe(true);

    const primarySelf = await request(app)
      .delete(`/api/pets/${petId}/owners/${ownerId}`)
      .set('Authorization', `Bearer mock-${ownerId}`);
    expect(primarySelf.status).toBe(400);
  });

  it('returns 404 when removing a user who is not a joint owner', async () => {
    const res = await request(app)
      .delete(`/api/pets/${petId}/owners/${strangerId}`)
      .set('Authorization', `Bearer mock-${ownerId}`);
    expect(res.status).toBe(404);
  });
});
