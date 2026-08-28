import jwt from 'jsonwebtoken';
import request from 'supertest';

import config from '../../config';
import { UserRole } from '../../models/UserRole';
import { createApp } from '../app';
import { store } from '../store';

const app = createApp();
const secret = config.app.jwtSecret;

describe('API Integration Tests', () => {
  let ownerToken: string;
  let vetToken: string;
  let adminToken: string;
  let ownerId: string;
  let vetId: string;
  let adminId: string;
  let petId: string;

  beforeEach(() => {
    store.users.clear();
    store.pets.clear();
    store.medicalRecords.clear();
    store.appointments.clear();
    store.medications.clear();

    // Create test users
    ownerId = 'owner-1';
    vetId = 'vet-1';
    adminId = 'admin-1';

    store.users.set(ownerId, {
      id: ownerId,
      email: 'owner@test.com',
      name: 'Pet Owner',
      role: UserRole.OWNER,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
    });

    store.users.set(vetId, {
      id: vetId,
      email: 'vet@test.com',
      name: 'Dr. Vet',
      role: UserRole.VET,
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

    // Generate tokens
    ownerToken = jwt.sign({ sub: ownerId, email: 'owner@test.com', role: UserRole.OWNER }, secret);
    vetToken = jwt.sign({ sub: vetId, email: 'vet@test.com', role: UserRole.VET }, secret);
    adminToken = jwt.sign({ sub: adminId, email: 'admin@test.com', role: UserRole.ADMIN }, secret);

    // Create test pet
    petId = 'pet-1';
    store.pets.set(petId, {
      id: petId,
      ownerId,
      name: 'Fluffy',
      species: 'cat',
      breed: 'Persian',
      dateOfBirth: '2020-01-01',
      microchipId: 'chip-123',
      photoUrl: 'https://example.com/fluffy.jpg',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  describe('User Endpoints', () => {
    describe('GET /api/users/me', () => {
      it('should return current user profile', async () => {
        const response = await request(app)
          .get('/api/users/me')
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.id).toBe(ownerId);
        expect(response.body.data.email).toBe('owner@test.com');
      });

      it('should not expose password hash', async () => {
        const response = await request(app)
          .get('/api/users/me')
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.body.data).not.toHaveProperty('passwordHash');
        expect(response.body.data).not.toHaveProperty('password_hash');
      });

      it('should require authentication', async () => {
        const response = await request(app).get('/api/users/me');

        expect(response.status).toBe(401);
      });
    });

    describe('GET /api/users', () => {
      it('should require admin role', async () => {
        const response = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.status).toBe(403);
      });

      it('should return user list for admin', async () => {
        const response = await request(app)
          .get('/api/users')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(Array.isArray(response.body.data)).toBe(true);
      });

      it('should support pagination', async () => {
        const response = await request(app)
          .get('/api/users?page=1&limit=10')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
      });

      it('should support role filtering', async () => {
        const response = await request(app)
          .get(`/api/users?role=${UserRole.VET}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
      });
    });
  });

  describe('Pet Endpoints', () => {
    describe('GET /api/pets', () => {
      it('should return user pets', async () => {
        const response = await request(app)
          .get('/api/pets')
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(Array.isArray(response.body.data)).toBe(true);
        expect(response.body.data.length).toBeGreaterThan(0);
      });

      it('should require authentication', async () => {
        const response = await request(app).get('/api/pets');

        expect(response.status).toBe(401);
      });
    });

    describe('POST /api/pets', () => {
      it('should create new pet', async () => {
        const response = await request(app)
          .post('/api/pets')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            name: 'Buddy',
            species: 'dog',
            breed: 'Golden Retriever',
            dateOfBirth: '2021-06-15',
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.data.name).toBe('Buddy');
        expect(response.body.data.ownerId).toBe(ownerId);
      });

      it('should validate required fields', async () => {
        const response = await request(app)
          .post('/api/pets')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            species: 'dog',
          });

        expect(response.status).toBe(400);
      });
    });

    describe('GET /api/pets/:id', () => {
      it('should return pet details', async () => {
        const response = await request(app)
          .get(`/api/pets/${petId}`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.id).toBe(petId);
        expect(response.body.data.name).toBe('Fluffy');
      });

      it('should return 404 for non-existent pet', async () => {
        const response = await request(app)
          .get('/api/pets/non-existent')
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.status).toBe(404);
      });
    });

    describe('PUT /api/pets/:id', () => {
      it('should update pet', async () => {
        const response = await request(app)
          .put(`/api/pets/${petId}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            name: 'Fluffington',
          });

        expect(response.status).toBe(200);
        expect(response.body.data.name).toBe('Fluffington');
      });

      it('should prevent unauthorized updates', async () => {
        const response = await request(app)
          .put(`/api/pets/${petId}`)
          .set('Authorization', `Bearer ${vetToken}`)
          .send({
            name: 'Hacked',
          });

        expect(response.status).toBe(403);
      });
    });

    describe('DELETE /api/pets/:id', () => {
      it('should delete pet', async () => {
        const response = await request(app)
          .delete(`/api/pets/${petId}`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.status).toBe(200);

        // Verify deletion
        const getResponse = await request(app)
          .get(`/api/pets/${petId}`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(getResponse.status).toBe(404);
      });
    });
  });

  describe('Medical Records Endpoints', () => {
    let recordId: string;

    beforeEach(() => {
      recordId = 'record-1';
      store.medicalRecords.set(recordId, {
        id: recordId,
        petId,
        ownerId,
        vetId,
        type: 'checkup',
        visitDate: new Date().toISOString(),
        diagnosis: 'Healthy',
        treatment: 'Routine checkup',
        notes: 'All good',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    describe('GET /api/medicalRecords', () => {
      it('should return medical records for user', async () => {
        const response = await request(app)
          .get('/api/medicalRecords')
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.data)).toBe(true);
      });

      it('should support filtering by pet', async () => {
        const response = await request(app)
          .get(`/api/medicalRecords?petId=${petId}`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.status).toBe(200);
      });
    });

    describe('POST /api/medicalRecords', () => {
      it('should create medical record', async () => {
        const response = await request(app)
          .post('/api/medicalRecords')
          .set('Authorization', `Bearer ${vetToken}`)
          .send({
            petId,
            ownerId,
            type: 'vaccination',
            visitDate: new Date().toISOString(),
            diagnosis: 'Rabies vaccination',
          });

        expect(response.status).toBe(201);
        expect(response.body.data.type).toBe('vaccination');
      });
    });

    describe('GET /api/medicalRecords/:id', () => {
      it('should return record details', async () => {
        const response = await request(app)
          .get(`/api/medicalRecords/${recordId}`)
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.id).toBe(recordId);
      });
    });
  });

  describe('Appointment Endpoints', () => {
    describe('GET /api/appointments', () => {
      it('should return appointments', async () => {
        const response = await request(app)
          .get('/api/appointments')
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.data)).toBe(true);
      });
    });

    describe('POST /api/appointments', () => {
      it('should create appointment', async () => {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 7);

        const response = await request(app)
          .post('/api/appointments')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            petId,
            vetId,
            scheduledAt: futureDate.toISOString(),
            reason: 'Checkup',
          });

        expect(response.status).toBe(201);
        expect(response.body.data.reason).toBe('Checkup');
      });
    });
  });

  describe('Medication Endpoints', () => {
    describe('GET /api/medications', () => {
      it('should return medications', async () => {
        const response = await request(app)
          .get('/api/medications')
          .set('Authorization', `Bearer ${ownerToken}`);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.data)).toBe(true);
      });
    });

    describe('POST /api/medications', () => {
      it('should create medication', async () => {
        const response = await request(app)
          .post('/api/medications')
          .set('Authorization', `Bearer ${vetToken}`)
          .send({
            petId,
            name: 'Amoxicillin',
            dosage: '500mg',
            frequency: 'twice daily',
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          });

        expect(response.status).toBe(201);
        expect(response.body.data.name).toBe('Amoxicillin');
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 401 for missing token', async () => {
      const response = await request(app).get('/api/pets');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 for insufficient permissions', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should return 404 for non-existent resource', async () => {
      const response = await request(app)
        .get('/api/pets/non-existent')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid request', async () => {
      const response = await request(app)
        .post('/api/pets')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          // Missing required fields
        });

      expect(response.status).toBe(400);
    });
  });

  describe('Response Format', () => {
    it('should return consistent response structure', async () => {
      const response = await request(app)
        .get('/api/pets')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
    });

    it('should include error details on failure', async () => {
      const response = await request(app).get('/api/pets');

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
    });
  });
});
