import http from 'http';

import { UserRole } from '../../models/UserRole';
import { createApp } from '../app';
import { store } from '../store';

function getJson(
  port: number,
  path: string,
  token?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

jest.mock('../../src/repositories/petRepository', () => ({
  petRepository: {
    findAll: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    findByOwnerId: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../src/repositories/userRepository', () => ({
  userRepository: {
    findById: jest.fn().mockResolvedValue(null),
  },
}));

describe('REST API smoke', () => {
  let server: http.Server;
  let port: number;
  const mockUserId = 'smoke-test-user';
  const mockToken = `mock-${mockUserId}`;

  beforeAll((done) => {
    // Add a mock user to the store
    store.users.set(mockUserId, {
      id: mockUserId,
      email: 'smoke@test.com',
      name: 'Smoke Test User',
      role: UserRole.ADMIN, // Admin to pass all checks
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
    store.users.delete(mockUserId);
    server.close(() => done());
  });

  it('GET /api/health returns 200 (No auth required)', async () => {
    const { status, body } = await getJson(port, '/api/health');
    expect(status).toBe(200);
    expect(JSON.parse(body).ok).toBe(true);
  });

  it('GET /api/pets returns success wrapper (Auth required)', async () => {
    const { status, body } = await getJson(port, '/api/pets', mockToken);
    expect(status).toBe(200);
    const j = JSON.parse(body);
    expect(j.success).toBe(true);
    expect(Array.isArray(j.data)).toBe(true);
  });

  it('GET /api/medications returns array (Auth required)', async () => {
    const { status, body } = await getJson(port, '/api/medications?petId=p-demo-1', mockToken);
    expect(status).toBe(200);
    const j = JSON.parse(body);
    expect(j.success).toBe(true);
    expect(Array.isArray(j.data)).toBe(true);
  });
});
