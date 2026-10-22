/**
 * Integration tests for GET /admin/analytics
 *
 * Uses a mock DB pool injected via app.locals so no real Postgres is needed.
 * Install supertest: npm i -D supertest @types/supertest
 */
import http from 'http';

import { UserRole } from '../models/UserRole';
import { createApp } from '../server';
import { store } from '../server/store';

// ---------------------------------------------------------------------------
// Minimal supertest shim — avoids adding a new dependency for the test runner.
// Replace with `import request from 'supertest'` once supertest is installed.
// ---------------------------------------------------------------------------

function makeRequest(app: ReturnType<typeof createApp>) {
  const server = http.createServer(app);
  return {
    get(path: string) {
      return {
        set(headers: Record<string, string>) {
          return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
            const url = new URL(path, 'http://localhost');
            const options: http.RequestOptions = {
              hostname: 'localhost',
              path: url.pathname,
              method: 'GET',
              headers,
            };
            server.listen(0, () => {
              const addr = server.address() as { port: number };
              options.port = addr.port;
              const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                  server.close();
                  try {
                    resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
                  } catch {
                    resolve({ status: res.statusCode ?? 0, body: data });
                  }
                });
              });
              req.on('error', reject);
              req.end();
            });
          });
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// JWT stub helpers
// ---------------------------------------------------------------------------
function makeToken(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

const adminToken = makeToken({ id: 'u1', email: 'admin@test.com', role: UserRole.ADMIN });
const ownerToken = makeToken({ id: 'u2', email: 'owner@test.com', role: UserRole.OWNER });

// ---------------------------------------------------------------------------
// Mock DB pool
// ---------------------------------------------------------------------------
const mockQueryResults: Record<string, unknown[]> = {
  "last_login_at >= NOW() - INTERVAL '7 days'": [{ count: '42' }],
  "last_login_at >= NOW() - INTERVAL '30 days'": [{ count: '120' }],
  'pet_count::text': [
    { pet_count: '1', user_count: '30' },
    { pet_count: '2', user_count: '10' },
    { pet_count: '3', user_count: '5' },
  ],
  feature_events: [
    {
      qr_scanner: '15',
      medical_records: '80',
      appointments: '60',
      medications: '45',
      emergency: '5',
    },
  ],
  subscription_tier: [
    { tier: 'free', count: '90' },
    { tier: 'pro', count: '30' },
  ],
};

function mockDb() {
  return {
    query: async (sql: string) => {
      for (const [key, rows] of Object.entries(mockQueryResults)) {
        if (sql.includes(key)) return { rows };
      }
      return { rows: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GET /admin/analytics', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    store.users.clear();
    store.users.set('u1', {
      id: 'u1',
      email: 'admin@test.com',
      name: 'Admin User',
      role: UserRole.ADMIN,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
      twoFactorEnabled: true,
    });

    app = createApp(mockDb());
  });

  it('returns 401 when no token is provided', async () => {
    const { status } = await makeRequest(app).get('/admin/analytics').set({});
    expect(status).toBe(401);
  });

  it('returns 403 when authenticated as non-admin', async () => {
    const { status } = await makeRequest(app)
      .get('/admin/analytics')
      .set({ Authorization: `Bearer ${ownerToken}` });
    expect(status).toBe(403);
  });

  it('returns 403 when admin MFA is not enabled', async () => {
    store.users.set('u3', {
      id: 'u3',
      email: 'no-mfa@test.com',
      name: 'No MFA Admin',
      role: UserRole.ADMIN,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
      twoFactorEnabled: false,
    });

    const token = makeToken({ id: 'u3', email: 'no-mfa@test.com', role: UserRole.ADMIN });
    const { status } = await makeRequest(app)
      .get('/admin/analytics')
      .set({ Authorization: `Bearer ${token}` });

    expect(status).toBe(403);
  });

  it('returns 200 with analytics payload for admin', async () => {
    const { status, body } = (await makeRequest(app)
      .get('/admin/analytics')
      .set({ Authorization: `Bearer ${adminToken}` })) as {
      status: number;
      body: {
        activeUsers: { last7Days: number; last30Days: number };
        petDistribution: {
          totalPets: number;
          avgPetsPerUser: number;
          buckets: Record<string, number>;
        };
        featureAdoption: Record<string, number>;
        subscriptionTiers: Record<string, number>;
        generatedAt: string;
      };
    };

    expect(status).toBe(200);
    expect(body.activeUsers.last7Days).toBe(42);
    expect(body.activeUsers.last30Days).toBe(120);
    expect(body.petDistribution.totalPets).toBe(65); // 1*30 + 2*10 + 3*5
    expect(body.petDistribution.buckets['3+']).toBe(5);
    expect(body.featureAdoption.medicalRecords).toBe(80);
    expect(body.subscriptionTiers.free).toBe(90);
    expect(typeof body.generatedAt).toBe('string');
  });
});
