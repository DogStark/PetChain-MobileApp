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
  },
}));

const { query } = jest.requireMock('../../src/db') as { query: jest.Mock };
const { petRepository } = jest.requireMock('../../src/repositories/petRepository') as {
  petRepository: { create: jest.Mock };
};
const { userRepository } = jest.requireMock('../../src/repositories/userRepository') as {
  userRepository: { findById: jest.Mock };
};

describe('Audit trail logging (mutation coverage)', () => {
  const { createApp } = require('../app') as typeof import('../app');
  const app = createApp();
  const ownerId = 'owner-1';
  const adminId = 'admin-1';

  beforeEach(() => {
    query.mockClear();
    petRepository.create.mockReset();
    userRepository.findById.mockReset();
    store.users.clear();
    store.pets.clear();
    store.medications.clear();
    store.appointments.clear();

    store.users.set(ownerId, {
      id: ownerId,
      email: 'owner@test.com',
      name: 'Owner',
      role: UserRole.OWNER,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
    });

    store.users.set(adminId, {
      id: adminId,
      email: 'admin@test.com',
      name: 'Admin',
      role: UserRole.ADMIN,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
    });
  });

  function expectAuditInsert(action: 'CREATE' | 'UPDATE' | 'DELETE', actorId: string) {
    const calls = query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO audit_trail'),
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const params = calls[calls.length - 1][1] as any[];
    // params: [id, entityType, entityId, action, beforeData, afterData, changedBy, ip, ua]
    expect(params[3]).toBe(action);
    expect(params[6]).toBe(actorId); // actor from mock token
  }

  it('logs CREATE/UPDATE/DELETE for pet mutations', async () => {
    // Seed a pet in store for update/delete (route uses store for those)
    const petId = store.newId();
    store.pets.set(petId, {
      id: petId,
      name: 'Buddy',
      species: 'dog',
      breed: 'lab',
      ownerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    petRepository.create.mockResolvedValue({
      id: 'pet-created-1',
      name: 'Charlie',
      species: 'dog',
      breed: null,
      date_of_birth: null,
      microchip_id: null,
      photo_url: null,
      thumbnail_url: null,
      owner_id: ownerId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    userRepository.findById.mockResolvedValue({
      id: ownerId,
      name: 'Owner',
      email: 'owner@test.com',
    });

    await request(app)
      .post('/api/pets')
      .set('Authorization', `Bearer mock-${ownerId}`)
      .send({ name: 'Charlie', species: 'dog', ownerId });

    expectAuditInsert('CREATE', ownerId);

    await request(app)
      .put(`/api/pets/${petId}`)
      .set('Authorization', `Bearer mock-${ownerId}`)
      .send({ name: 'Buddy 2' });
    expectAuditInsert('UPDATE', ownerId);

    await request(app).delete(`/api/pets/${petId}`).set('Authorization', `Bearer mock-${ownerId}`);
    expectAuditInsert('DELETE', ownerId);
  });

  it('logs CREATE/UPDATE/DELETE for medication mutations', async () => {
    const petId = store.newId();
    store.pets.set(petId, {
      id: petId,
      name: 'Buddy',
      species: 'dog',
      ownerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    const createRes = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer mock-${adminId}`)
      .send({
        petId,
        name: 'Med A',
        dosage: '1 tab',
        frequency: 'daily',
        startDate: '2026-01-01',
      });
    expect(createRes.status).toBe(201);
    const medicationId = createRes.body.data.id;
    expectAuditInsert('CREATE', adminId);

    await request(app)
      .put(`/api/medications/${medicationId}`)
      .set('Authorization', `Bearer mock-${adminId}`)
      .send({ dosage: '2 tabs' });
    expectAuditInsert('UPDATE', adminId);

    await request(app)
      .delete(`/api/medications/${medicationId}`)
      .set('Authorization', `Bearer mock-${adminId}`);
    expectAuditInsert('DELETE', adminId);
  });

  it('logs CREATE/UPDATE/DELETE for appointment mutations', async () => {
    const petId = store.newId();
    store.pets.set(petId, {
      id: petId,
      name: 'Buddy',
      species: 'dog',
      ownerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    const createRes = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer mock-${ownerId}`)
      .send({ petId, vetId: adminId, date: '2026-01-02', time: '10:00' });
    expect(createRes.status).toBe(201);
    const appointmentId = createRes.body.data.id;
    expectAuditInsert('CREATE', ownerId);

    await request(app)
      .put(`/api/appointments/${appointmentId}`)
      .set('Authorization', `Bearer mock-${ownerId}`)
      .send({ notes: 'Updated notes' });
    expectAuditInsert('UPDATE', ownerId);

    await request(app)
      .delete(`/api/appointments/${appointmentId}`)
      .set('Authorization', `Bearer mock-${ownerId}`);
    expectAuditInsert('DELETE', ownerId);
  });
});
