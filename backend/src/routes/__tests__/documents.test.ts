import request from 'supertest';

import { UserRole } from '../../../models/UserRole';
import { createApp } from '../../app';
import { store } from '../../store';

const app = createApp();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeader(userId: string) {
  return { Authorization: `Bearer mock-${userId}` };
}

function makeUser(id: string, role: UserRole = UserRole.OWNER) {
  return {
    id,
    email: `${id}@test.com`,
    name: 'Test User',
    role,
    pets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isEmailVerified: true,
    twoFactorEnabled: false,
  };
}

function makePet(id: string, ownerId: string) {
  return {
    id,
    name: 'Buddy',
    species: 'dog',
    ownerId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function validDocBody(petId: string, overrides: Record<string, unknown> = {}) {
  return {
    petId,
    name: 'test-doc.pdf',
    category: 'vaccination',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    encryptedContent: Buffer.from('encrypted-content').toString('base64'),
    iv: 'a'.repeat(24),
    tag: 'b'.repeat(64),
    keyVersion: 1,
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const OWNER_ID = 'owner-1';
const VET_ID = 'vet-1';
const OTHER_OWNER_ID = 'owner-2';
const PET_ID = 'pet-1';

beforeEach(() => {
  // Clear documents between tests
  const docs = (store as unknown as Record<string, Map<string, unknown>>).documents;
  if (docs) docs.clear();

  store.users.clear();
  store.pets.clear();

  store.users.set(OWNER_ID, makeUser(OWNER_ID, UserRole.OWNER));
  store.users.set(VET_ID, makeUser(VET_ID, UserRole.VET));
  store.users.set(OTHER_OWNER_ID, makeUser(OTHER_OWNER_ID, UserRole.OWNER));
  store.pets.set(PET_ID, makePet(PET_ID, OWNER_ID));
});

// ─── POST /api/documents ──────────────────────────────────────────────────────

describe('POST /api/documents', () => {
  it('uploads a document successfully', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.version).toBe(1);
    expect(res.body.data).not.toHaveProperty('encryptedContent');
  });

  it('rejects missing petId', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { petId: '' }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects missing encryptedContent', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { encryptedContent: '' }));

    expect(res.status).toBe(400);
  });

  it('rejects missing iv or tag', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { iv: '' }));

    expect(res.status).toBe(400);
  });

  it('rejects unsupported MIME type', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { mimeType: 'application/exe' }));

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects oversized file', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { sizeBytes: 21 * 1024 * 1024 }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects upload for non-existent pet', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody('nonexistent-pet'));

    expect(res.status).toBe(400);
  });

  it("rejects owner uploading for another owner's pet", async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(OTHER_OWNER_ID))
      .send(validDocBody(PET_ID));

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).post('/api/documents').send(validDocBody(PET_ID));
    expect(res.status).toBe(401);
  });

  it('creates a new version when parentId is provided', async () => {
    // Upload v1
    const v1 = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));
    expect(v1.status).toBe(201);
    const docId = v1.body.data.id;

    // Upload v2
    const v2 = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { parentId: docId, name: 'test-doc-v2.pdf' }));

    expect(v2.status).toBe(201);
    expect(v2.body.data.version).toBe(2);
    expect(v2.body.data.parentId).toBe(docId);
  });

  it('enforces quota', async () => {
    // Set user tier to free (50 MB limit) and upload a doc that fills it
    const bigDoc = validDocBody(PET_ID, { sizeBytes: 50 * 1024 * 1024 });
    await request(app).post('/api/documents').set(authHeader(OWNER_ID)).send(bigDoc);

    // Second upload should exceed quota
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { sizeBytes: 1024 }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
  });
});

// ─── GET /api/documents ───────────────────────────────────────────────────────

describe('GET /api/documents', () => {
  it('lists documents for a pet', async () => {
    await request(app).post('/api/documents').set(authHeader(OWNER_ID)).send(validDocBody(PET_ID));

    const res = await request(app).get(`/api/documents?petId=${PET_ID}`).set(authHeader(OWNER_ID));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0]).not.toHaveProperty('encryptedContent');
  });

  it('filters by category', async () => {
    await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { category: 'vaccination' }));
    await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { category: 'insurance', name: 'ins.pdf' }));

    const res = await request(app)
      .get(`/api/documents?petId=${PET_ID}&category=vaccination`)
      .set(authHeader(OWNER_ID));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].category).toBe('vaccination');
  });

  it('excludes deleted documents by default', async () => {
    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));
    const docId = upload.body.data.id;

    await request(app).delete(`/api/documents/${docId}`).set(authHeader(OWNER_ID));

    const res = await request(app).get(`/api/documents?petId=${PET_ID}`).set(authHeader(OWNER_ID));

    expect(res.body.data.length).toBe(0);
  });

  it('includes deleted documents when includeDeleted=true', async () => {
    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));
    await request(app).delete(`/api/documents/${upload.body.data.id}`).set(authHeader(OWNER_ID));

    const res = await request(app)
      .get(`/api/documents?petId=${PET_ID}&includeDeleted=true`)
      .set(authHeader(OWNER_ID));

    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].deletedAt).toBeDefined();
  });

  it('returns only latest version per document chain', async () => {
    const v1 = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));
    await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { parentId: v1.body.data.id }));

    const res = await request(app).get(`/api/documents?petId=${PET_ID}`).set(authHeader(OWNER_ID));

    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].version).toBe(2);
  });
});

// ─── GET /api/documents/:id ───────────────────────────────────────────────────

describe('GET /api/documents/:id', () => {
  it('returns document with encrypted content for download', async () => {
    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));
    const docId = upload.body.data.id;

    const res = await request(app).get(`/api/documents/${docId}`).set(authHeader(OWNER_ID));

    expect(res.status).toBe(200);
    expect(res.body.data.encryptedContent).toBeDefined();
    expect(res.body.data.iv).toBeDefined();
    expect(res.body.data.tag).toBeDefined();
  });

  it('returns 404 for non-existent document', async () => {
    const res = await request(app).get('/api/documents/nonexistent').set(authHeader(OWNER_ID));

    expect(res.status).toBe(404);
  });

  it('returns 403 for unauthorized access', async () => {
    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));

    const res = await request(app)
      .get(`/api/documents/${upload.body.data.id}`)
      .set(authHeader(OTHER_OWNER_ID));

    expect(res.status).toBe(403);
  });

  it('returns 404 for soft-deleted document', async () => {
    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));
    const docId = upload.body.data.id;
    await request(app).delete(`/api/documents/${docId}`).set(authHeader(OWNER_ID));

    const res = await request(app).get(`/api/documents/${docId}`).set(authHeader(OWNER_ID));

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/documents/:id/versions ─────────────────────────────────────────

describe('GET /api/documents/:id/versions', () => {
  it('returns all versions of a document', async () => {
    const v1 = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));
    const docId = v1.body.data.id;

    await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { parentId: docId }));

    const res = await request(app)
      .get(`/api/documents/${docId}/versions`)
      .set(authHeader(OWNER_ID));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].version).toBe(1);
    expect(res.body.data[1].version).toBe(2);
  });
});

// ─── DELETE /api/documents/:id ────────────────────────────────────────────────

describe('DELETE /api/documents/:id', () => {
  it('soft-deletes a document', async () => {
    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));
    const docId = upload.body.data.id;

    const res = await request(app).delete(`/api/documents/${docId}`).set(authHeader(OWNER_ID));

    expect(res.status).toBe(200);

    // Verify it's soft-deleted (not accessible via GET)
    const getRes = await request(app).get(`/api/documents/${docId}`).set(authHeader(OWNER_ID));
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for already-deleted document', async () => {
    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));
    const docId = upload.body.data.id;
    await request(app).delete(`/api/documents/${docId}`).set(authHeader(OWNER_ID));

    const res = await request(app).delete(`/api/documents/${docId}`).set(authHeader(OWNER_ID));

    expect(res.status).toBe(404);
  });

  it('prevents vets from deleting documents', async () => {
    // Add vet appointment so vet can access the doc
    store.appointments.set('appt-1', {
      id: 'appt-1',
      petId: PET_ID,
      vetId: VET_ID,
      date: new Date().toISOString().slice(0, 10),
      time: '10:00',
      type: 'routine_checkup' as any,
      status: 'confirmed' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));

    const res = await request(app)
      .delete(`/api/documents/${upload.body.data.id}`)
      .set(authHeader(VET_ID));

    expect(res.status).toBe(403);
  });

  it('returns 403 for unauthorized user', async () => {
    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));

    const res = await request(app)
      .delete(`/api/documents/${upload.body.data.id}`)
      .set(authHeader(OTHER_OWNER_ID));

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/documents/:id/restore ─────────────────────────────────────────

describe('POST /api/documents/:id/restore', () => {
  it('restores a soft-deleted document', async () => {
    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));
    const docId = upload.body.data.id;
    await request(app).delete(`/api/documents/${docId}`).set(authHeader(OWNER_ID));

    const res = await request(app)
      .post(`/api/documents/${docId}/restore`)
      .set(authHeader(OWNER_ID));

    expect(res.status).toBe(200);
    expect(res.body.data.deletedAt).toBeUndefined();
  });

  it('returns 400 when restoring a non-deleted document', async () => {
    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));

    const res = await request(app)
      .post(`/api/documents/${upload.body.data.id}/restore`)
      .set(authHeader(OWNER_ID));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('prevents vets from restoring documents', async () => {
    store.appointments.set('appt-2', {
      id: 'appt-2',
      petId: PET_ID,
      vetId: VET_ID,
      date: new Date().toISOString().slice(0, 10),
      time: '10:00',
      type: 'routine_checkup' as any,
      status: 'confirmed' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const upload = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID));
    const docId = upload.body.data.id;
    await request(app).delete(`/api/documents/${docId}`).set(authHeader(OWNER_ID));

    const res = await request(app).post(`/api/documents/${docId}/restore`).set(authHeader(VET_ID));

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/documents/quota/:ownerId ───────────────────────────────────────

describe('GET /api/documents/quota/:ownerId', () => {
  it('returns quota info for the owner', async () => {
    const res = await request(app)
      .get(`/api/documents/quota/${OWNER_ID}`)
      .set(authHeader(OWNER_ID));

    expect(res.status).toBe(200);
    expect(res.body.data.used).toBeDefined();
    expect(res.body.data.limit).toBeDefined();
    expect(res.body.data.remaining).toBeDefined();
  });

  it("returns 403 when owner requests another owner's quota", async () => {
    const res = await request(app)
      .get(`/api/documents/quota/${OWNER_ID}`)
      .set(authHeader(OTHER_OWNER_ID));

    expect(res.status).toBe(403);
  });

  it('includes versioned documents in quota calculation', async () => {
    const v1 = await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { sizeBytes: 2048 }));
    await request(app)
      .post('/api/documents')
      .set(authHeader(OWNER_ID))
      .send(validDocBody(PET_ID, { parentId: v1.body.data.id, sizeBytes: 1024 }));

    const res = await request(app)
      .get(`/api/documents/quota/${OWNER_ID}`)
      .set(authHeader(OWNER_ID));

    // Both versions count toward quota
    expect(res.body.data.used).toBe(3072);
  });
});
