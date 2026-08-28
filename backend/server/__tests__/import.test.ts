import http from 'http';

import { UserRole } from '../../models/UserRole';
import { createApp } from '../app';
import { store } from '../store';

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function request(
  port: number,
  path: string,
  method: string,
  body: string,
  contentType: string,
  token?: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(body).toString(),
      Accept: 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

describe('POST /api/import/pets', () => {
  let server: http.Server;
  let port: number;
  const adminId = 'import-admin-user';
  const ownerId = 'import-owner-user';
  const adminToken = `mock-${adminId}`;

  beforeAll((done) => {
    store.users.set(adminId, {
      id: adminId,
      email: 'admin@import.test',
      name: 'Import Admin',
      role: UserRole.ADMIN,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
    });
    store.users.set(ownerId, {
      id: ownerId,
      email: 'owner@import.test',
      name: 'Import Owner',
      role: UserRole.OWNER,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
    });

    const app = createApp();
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) port = addr.port;
      done();
    });
  });

  afterAll((done) => {
    store.users.delete(adminId);
    store.users.delete(ownerId);
    server.close(() => done());
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('401 when no token', async () => {
    const csv = `name,species,ownerId\nFido,dog,${ownerId}`;
    const { status } = await request(port, '/api/import/pets', 'POST', csv, 'text/plain');
    expect(status).toBe(401);
  });

  it('403 when OWNER role tries to import', async () => {
    const ownerToken = `mock-${ownerId}`;
    const csv = `name,species,ownerId\nFido,dog,${ownerId}`;
    const { status } = await request(
      port,
      '/api/import/pets',
      'POST',
      csv,
      'text/plain',
      ownerToken,
    );
    expect(status).toBe(403);
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it('400 on empty body', async () => {
    const { status, body } = await request(
      port,
      '/api/import/pets',
      'POST',
      '',
      'text/plain',
      adminToken,
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 on body with no data rows', async () => {
    const csv = `name,species,ownerId`;
    const { status, body } = await request(
      port,
      '/api/import/pets',
      'POST',
      csv,
      'text/plain',
      adminToken,
    );
    expect(status).toBe(200);
    expect(body.data.imported).toBe(0);
  });

  it('reports error for missing required fields', async () => {
    const csv = `name,species,ownerId\n,dog,${ownerId}`;
    const { status, body } = await request(
      port,
      '/api/import/pets',
      'POST',
      csv,
      'text/plain',
      adminToken,
    );
    expect(status).toBe(200);
    expect(body.data.skipped).toBe(1);
    expect(body.data.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
    );
  });

  it('reports error for non-existent ownerId', async () => {
    const csv = `name,species,ownerId\nFido,dog,nonexistent-user`;
    const { status, body } = await request(
      port,
      '/api/import/pets',
      'POST',
      csv,
      'text/plain',
      adminToken,
    );
    expect(status).toBe(200);
    expect(body.data.skipped).toBe(1);
    expect(body.data.errors[0].field).toBe('ownerId');
  });

  it('reports error for invalid dateOfBirth format', async () => {
    const csv = `name,species,ownerId,dateOfBirth\nFido,dog,${ownerId},15-03-2020`;
    const { status, body } = await request(
      port,
      '/api/import/pets',
      'POST',
      csv,
      'text/plain',
      adminToken,
    );
    expect(status).toBe(200);
    expect(body.data.skipped).toBe(1);
    expect(body.data.errors[0].field).toBe('dateOfBirth');
  });

  // ── Success ───────────────────────────────────────────────────────────────

  it('imports a single valid pet', async () => {
    const csv = `name,species,ownerId\nRex,dog,${ownerId}`;
    const { status, body } = await request(
      port,
      '/api/import/pets',
      'POST',
      csv,
      'text/plain',
      adminToken,
    );
    expect(status).toBe(201);
    expect(body.data.imported).toBe(1);
    expect(body.data.skipped).toBe(0);
    expect(body.data.errors).toHaveLength(0);
    expect(body.data.pets[0].name).toBe('Rex');
  });

  it('imports valid pets and skips invalid ones in the same CSV', async () => {
    const csv = [
      'name,species,ownerId,dateOfBirth,breed',
      `Luna,cat,${ownerId},2021-06-01,Siamese`, // valid
      `,dog,${ownerId},,`, // invalid: missing name
      `Milo,rabbit,${ownerId},2022-04-15,`, // valid
      `Max,dog,nonexistent-owner,,`, // invalid: bad ownerId
    ].join('\n');

    const { status, body } = await request(
      port,
      '/api/import/pets',
      'POST',
      csv,
      'text/plain',
      adminToken,
    );
    expect(status).toBe(201);
    expect(body.data.imported).toBe(2);
    expect(body.data.skipped).toBe(2);
    expect(body.data.errors).toHaveLength(2);
  });

  it('imports pets with optional fields', async () => {
    const csv = `name,species,ownerId,breed,dateOfBirth,microchipId\nBella,cat,${ownerId},Persian,2019-11-20,CHIP-999`;
    const { status, body } = await request(
      port,
      '/api/import/pets',
      'POST',
      csv,
      'text/plain',
      adminToken,
    );
    expect(status).toBe(201);
    expect(body.data.pets[0].name).toBe('Bella');

    // Confirm pet exists in store
    const stored = store.pets.get(body.data.pets[0].id);
    expect(stored?.breed).toBe('Persian');
    expect(stored?.microchipId).toBe('CHIP-999');
    expect(stored?.dateOfBirth).toBe('2019-11-20');
  });

  it('handles quoted CSV fields containing commas', async () => {
    const csv = `name,species,ownerId,breed\n"Charlie, Jr.",dog,${ownerId},"Labrador, Mixed"`;
    const { status, body } = await request(
      port,
      '/api/import/pets',
      'POST',
      csv,
      'text/plain',
      adminToken,
    );
    expect(status).toBe(201);
    expect(body.data.pets[0].name).toBe('Charlie, Jr.');
  });
});
