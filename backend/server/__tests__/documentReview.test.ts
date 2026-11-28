import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import config from '../../config';
import { AppointmentStatus, AppointmentType } from '../../models/Appointment';
import { UserRole } from '../../models/UserRole';
import documentsRouter, { type StoredDocument } from '../../src/routes/documents';
import { store, type StoredAppointment, type StoredPet, type StoredUser } from '../store';

const app = express();
app.use(express.json());
app.use('/api/documents', documentsRouter);

const ownerId = 'review-owner';
const vetId = 'review-vet';
const otherVetId = 'unassigned-vet';
const petId = 'review-pet';
const tokens = {
  owner: jwt.sign(
    { sub: ownerId, email: 'owner@test.invalid', role: UserRole.OWNER },
    config.app.jwtSecret,
  ),
  vet: jwt.sign(
    { sub: vetId, email: 'vet@test.invalid', role: UserRole.VET },
    config.app.jwtSecret,
  ),
  otherVet: jwt.sign(
    { sub: otherVetId, email: 'other-vet@test.invalid', role: UserRole.VET },
    config.app.jwtSecret,
  ),
};

const documentStore = store as typeof store & { documents: Map<string, StoredDocument> };
const documents = documentStore.documents;

function makeUser(id: string, role: UserRole): StoredUser {
  const t = new Date().toISOString();
  return {
    id,
    email: `${id}@test.invalid`,
    name: 'Test user',
    role,
    pets: [],
    createdAt: t,
    updatedAt: t,
    isEmailVerified: true,
    twoFactorEnabled: false,
  };
}

function makePet(): StoredPet {
  const t = new Date().toISOString();
  return {
    id: petId,
    name: 'Private pet',
    species: 'cat',
    ownerId,
    createdAt: t,
    updatedAt: t,
  };
}

function addAppointment(status = AppointmentStatus.CONFIRMED): void {
  const t = new Date().toISOString();
  const appointment: StoredAppointment = {
    id: 'review-appointment',
    petId,
    vetId,
    date: t.slice(0, 10),
    time: '10:00',
    type: AppointmentType.ROUTINE_CHECKUP,
    status,
    createdAt: t,
    updatedAt: t,
  };
  store.appointments.set(appointment.id, appointment);
}

async function uploadAsOwner(): Promise<string> {
  const response = await request(app)
    .post('/api/documents')
    .set('Authorization', `Bearer ${tokens.owner}`)
    .send({
      petId,
      name: 'attachment.pdf',
      category: 'vet_report',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      encryptedContent: 'ciphertext',
      iv: 'initialization-vector',
      tag: 'authentication-tag',
      keyVersion: 1,
    });
  expect(response.status).toBe(201);
  const id: unknown = response.body?.data?.id;
  if (typeof id !== 'string') throw new Error('Document upload response did not include an id');
  return id;
}

beforeEach(() => {
  store.users.clear();
  store.pets.clear();
  store.appointments.clear();
  documents.clear();
  store.users.set(ownerId, makeUser(ownerId, UserRole.OWNER));
  store.users.set(vetId, makeUser(vetId, UserRole.VET));
  store.users.set(otherVetId, makeUser(otherVetId, UserRole.VET));
  store.pets.set(petId, makePet());
});

describe('clinician attachment review', () => {
  it('creates a pending state and accepts it only through an assigned clinician', async () => {
    addAppointment();
    const id = await uploadAsOwner();

    const upload = await request(app)
      .get('/api/documents')
      .query({ petId })
      .set('Authorization', `Bearer ${tokens.owner}`);
    expect(upload.body.data[0]).toMatchObject({
      id,
      reviewStatus: 'pending_review',
      canReview: false,
      canRetry: false,
    });

    const assignedList = await request(app)
      .get('/api/documents')
      .query({ petId })
      .set('Authorization', `Bearer ${tokens.vet}`);
    expect(assignedList.body.data[0].canReview).toBe(true);

    const ownerReview = await request(app)
      .post(`/api/documents/${id}/review`)
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({ status: 'accepted' });
    expect(ownerReview.status).toBe(403);

    const accepted = await request(app)
      .post(`/api/documents/${id}/review`)
      .set('Authorization', `Bearer ${tokens.vet}`)
      .send({ status: 'accepted' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toMatchObject({
      id,
      reviewStatus: 'accepted',
      canReview: false,
    });
    expect(accepted.body.data.reviewedAt).toEqual(expect.any(String));
    expect(accepted.body.data.reviewedBy).toBeUndefined();
  });

  it('denies an unrelated clinician and rejects stale or invalid review transitions', async () => {
    addAppointment();
    const id = await uploadAsOwner();

    const denied = await request(app)
      .post(`/api/documents/${id}/review`)
      .set('Authorization', `Bearer ${tokens.otherVet}`)
      .send({ status: 'accepted' });
    expect(denied.status).toBe(403);

    const invalid = await request(app)
      .post(`/api/documents/${id}/review`)
      .set('Authorization', `Bearer ${tokens.vet}`)
      .send({ status: 'pending_review' });
    expect(invalid.status).toBe(400);

    const accepted = await request(app)
      .post(`/api/documents/${id}/review`)
      .set('Authorization', `Bearer ${tokens.vet}`)
      .send({ status: 'accepted' });
    expect(accepted.status).toBe(200);

    const stale = await request(app)
      .post(`/api/documents/${id}/review`)
      .set('Authorization', `Bearer ${tokens.vet}`)
      .send({ status: 'rejected' });
    expect(stale.status).toBe(409);
  });

  it('does not allow a clinician to review a superseded version', async () => {
    addAppointment();
    const originalId = await uploadAsOwner();
    const replacement = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({
        petId,
        name: 'attachment-v2.pdf',
        category: 'vet_report',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        encryptedContent: 'new-ciphertext',
        iv: 'new-vector',
        tag: 'new-tag',
        parentId: originalId,
      });
    expect(replacement.status).toBe(201);

    const staleReview = await request(app)
      .post(`/api/documents/${originalId}/review`)
      .set('Authorization', `Bearer ${tokens.vet}`)
      .send({ status: 'accepted' });
    expect(staleReview.status).toBe(409);

    const list = await request(app)
      .get('/api/documents')
      .query({ petId })
      .set('Authorization', `Bearer ${tokens.vet}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      id: replacement.body.data.id,
      reviewStatus: 'pending_review',
      canReview: true,
    });
  });

  it.each(['rejected', 'expired'] as const)(
    'allows an owner to replace a %s attachment and blocks stale retries',
    async (status) => {
      addAppointment();
      const id = await uploadAsOwner();
      const marked = await request(app)
        .post(`/api/documents/${id}/review`)
        .set('Authorization', `Bearer ${tokens.vet}`)
        .send({ status });
      expect(marked.status).toBe(200);
      expect(marked.body.data.canRetry).toBe(false);

      const ownerList = await request(app)
        .get('/api/documents')
        .query({ petId })
        .set('Authorization', `Bearer ${tokens.owner}`);
      expect(ownerList.body.data[0].canRetry).toBe(true);

      const vetRetry = await request(app)
        .post('/api/documents')
        .set('Authorization', `Bearer ${tokens.vet}`)
        .send({
          petId,
          name: 'unauthorized-retry.pdf',
          category: 'vet_report',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          encryptedContent: 'unauthorized-ciphertext',
          iv: 'unauthorized-vector',
          tag: 'unauthorized-tag',
          retryOfId: id,
        });
      expect(vetRetry.status).toBe(403);

      const replacement = await request(app)
        .post('/api/documents')
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({
          petId,
          name: 'attachment-updated.pdf',
          category: 'vet_report',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          encryptedContent: 'replacement-ciphertext',
          iv: 'replacement-vector',
          tag: 'replacement-tag',
          keyVersion: 1,
          retryOfId: id,
        });
      expect(replacement.status).toBe(201);
      expect(replacement.body.data).toMatchObject({
        version: 2,
        reviewStatus: 'pending_review',
        canRetry: false,
      });

      const staleRetry = await request(app)
        .post('/api/documents')
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({
          petId,
          name: 'duplicate.pdf',
          category: 'vet_report',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          encryptedContent: 'duplicate-ciphertext',
          iv: 'duplicate-vector',
          tag: 'duplicate-tag',
          retryOfId: id,
        });
      expect(staleRetry.status).toBe(409);
    },
  );

  it('revokes review permission when the clinician appointment is cancelled', async () => {
    addAppointment(AppointmentStatus.CANCELLED);
    const id = await uploadAsOwner();

    const list = await request(app)
      .get('/api/documents')
      .query({ petId })
      .set('Authorization', `Bearer ${tokens.vet}`);
    expect(list.body.data).toHaveLength(0);

    const denied = await request(app)
      .post(`/api/documents/${id}/review`)
      .set('Authorization', `Bearer ${tokens.vet}`)
      .send({ status: 'accepted' });
    expect(denied.status).toBe(403);
  });
});
