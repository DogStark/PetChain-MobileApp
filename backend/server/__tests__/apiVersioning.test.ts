/**
 * API versioning coexistence tests — verifies that /api/v1 and /api/v2
 * endpoints coexist correctly with the expected breaking changes in v2.
 *
 * Closes #79
 */
import http from 'http';

import { createApp } from '../app';

// ── helpers ──────────────────────────────────────────────────────────────────

interface Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json<T = unknown>(): T;
}

function request(port: number, method: string, path: string, body?: unknown): Promise<Response> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: bodyStr,
            json<T>() {
              return JSON.parse(bodyStr) as T;
            },
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get = (port: number, path: string) => request(port, 'GET', path);
const post = (port: number, path: string, body: unknown) => request(port, 'POST', path, body);
const del = (port: number, path: string) => request(port, 'DELETE', path);

// ── test suite ────────────────────────────────────────────────────────────────

describe('API versioning coexistence', () => {
  let server: http.Server;
  let port: number;

  beforeAll((done) => {
    const app = createApp();
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) port = addr.port;
      done();
    });
  });

  afterAll((done) => server.close(() => done()));

  // ── health checks ──────────────────────────────────────────────────────────

  describe('health endpoints', () => {
    it('GET /api/v1/health returns version v1', async () => {
      const res = await get(port, '/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.json<{ version: string }>().version).toBe('v1');
    });

    it('GET /api/v2/health returns version v2', async () => {
      const res = await get(port, '/api/v2/health');
      expect(res.status).toBe(200);
      expect(res.json<{ version: string }>().version).toBe('v2');
    });

    it('legacy GET /api/health still works', async () => {
      const res = await get(port, '/api/health');
      expect(res.status).toBe(200);
      expect(res.json<{ ok: boolean }>().ok).toBe(true);
    });
  });

  // ── deprecation headers ────────────────────────────────────────────────────

  describe('v1 deprecation headers (RFC 8594)', () => {
    it('v1 responses include Deprecation: true', async () => {
      const res = await get(port, '/api/v1/health');
      expect(res.headers['deprecation']).toBe('true');
    });

    it('v1 responses include Sunset header', async () => {
      const res = await get(port, '/api/v1/health');
      expect(res.headers['sunset']).toBeDefined();
      // Sunset must be a future date (after v2 launch 2026-06-01)
      const sunset = new Date(res.headers['sunset'] as string);
      expect(sunset.getTime()).toBeGreaterThan(new Date('2026-06-01').getTime());
    });

    it('v1 responses include Link header pointing to v2', async () => {
      const res = await get(port, '/api/v1/health');
      const link = res.headers['link'] as string;
      expect(link).toContain('/api/v2');
      expect(link).toContain('successor-version');
    });

    it('v2 responses do NOT include Deprecation header', async () => {
      const res = await get(port, '/api/v2/health');
      expect(res.headers['deprecation']).toBeUndefined();
    });
  });

  // ── pets: v1 vs v2 field differences ──────────────────────────────────────

  describe('GET /pets — field naming', () => {
    it('v1 GET /pets/:id returns dateOfBirth field', async () => {
      const res = await get(port, '/api/v1/pets/p-demo-1');
      expect(res.status).toBe(200);
      const pet = res.json<{ success: boolean; data: Record<string, unknown> }>().data;
      expect(pet).toHaveProperty('dateOfBirth');
      expect(pet).not.toHaveProperty('birthDate');
    });

    it('v2 GET /pets/:id returns birthDate field (renamed)', async () => {
      const res = await get(port, '/api/v2/pets/p-demo-1');
      expect(res.status).toBe(200);
      const pet = res.json<{ success: boolean; data: Record<string, unknown> }>().data;
      expect(pet).toHaveProperty('birthDate');
      expect(pet).not.toHaveProperty('dateOfBirth');
    });

    it('v1 GET /pets/:id returns owner field', async () => {
      const res = await get(port, '/api/v1/pets/p-demo-1');
      const pet = res.json<{ data: Record<string, unknown> }>().data;
      expect(pet).toHaveProperty('owner');
      expect(pet).not.toHaveProperty('ownerInfo');
    });

    it('v2 GET /pets/:id returns ownerInfo field (renamed)', async () => {
      const res = await get(port, '/api/v2/pets/p-demo-1');
      const pet = res.json<{ data: Record<string, unknown> }>().data;
      expect(pet).toHaveProperty('ownerInfo');
      expect(pet).not.toHaveProperty('owner');
    });
  });

  // ── pets: v1 vs v2 list shape ──────────────────────────────────────────────

  describe('GET /pets — list shape', () => {
    it('v1 GET /pets returns flat array in data', async () => {
      const res = await get(port, '/api/v1/pets');
      expect(res.status).toBe(200);
      const body = res.json<{ success: boolean; data: unknown }>();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('v2 GET /pets returns paginated envelope', async () => {
      const res = await get(port, '/api/v2/pets');
      expect(res.status).toBe(200);
      const body = res.json<{
        success: boolean;
        data: { data: unknown[]; total: number; page: number; limit: number };
      }>();
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('data');
      expect(body.data).toHaveProperty('total');
      expect(body.data).toHaveProperty('page');
      expect(body.data).toHaveProperty('limit');
      expect(Array.isArray(body.data.data)).toBe(true);
    });

    it('v2 GET /pets supports ?page and ?limit params', async () => {
      const res = await get(port, '/api/v2/pets?page=1&limit=5');
      expect(res.status).toBe(200);
      const body = res.json<{ data: { page: number; limit: number } }>();
      expect(body.data.page).toBe(1);
      expect(body.data.limit).toBe(5);
    });
  });

  // ── pets: POST field differences ──────────────────────────────────────────

  describe('POST /pets — request body', () => {
    it('v2 POST /pets accepts birthDate and returns birthDate', async () => {
      const res = await post(port, '/api/v2/pets', {
        name: 'TestPetV2',
        species: 'cat',
        ownerId: 'u-demo-1',
        birthDate: '2022-03-10',
      });
      expect(res.status).toBe(201);
      const pet = res.json<{ data: Record<string, unknown> }>().data;
      expect(pet.birthDate).toBe('2022-03-10');
      expect(pet).not.toHaveProperty('dateOfBirth');
    });

    it('v1 POST /pets accepts dateOfBirth and returns dateOfBirth', async () => {
      const res = await post(port, '/api/v1/pets', {
        name: 'TestPetV1',
        species: 'dog',
        ownerId: 'u-demo-1',
        dateOfBirth: '2021-05-20',
      });
      expect(res.status).toBe(201);
      const pet = res.json<{ data: Record<string, unknown> }>().data;
      expect(pet.dateOfBirth).toBe('2021-05-20');
      expect(pet).not.toHaveProperty('birthDate');
    });
  });

  // ── pets: DELETE status code ───────────────────────────────────────────────

  describe('DELETE /pets — status code', () => {
    it('v1 DELETE /pets/:id returns 200 with JSON body', async () => {
      // Create a pet to delete
      const created = await post(port, '/api/v1/pets', {
        name: 'ToDeleteV1',
        species: 'rabbit',
        ownerId: 'u-demo-1',
      });
      const id = created.json<{ data: { id: string } }>().data.id;

      const res = await del(port, `/api/v1/pets/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.json<{ success: boolean }>().success).toBe(true);
    });

    it('v2 DELETE /pets/:id returns 204 with no body', async () => {
      // Create a pet to delete
      const created = await post(port, '/api/v2/pets', {
        name: 'ToDeleteV2',
        species: 'rabbit',
        ownerId: 'u-demo-1',
      });
      const id = created.json<{ data: { id: string } }>().data.id;

      const res = await del(port, `/api/v2/pets/${id}`);
      expect(res.status).toBe(204);
      expect(res.body).toBe('');
    });
  });

  // ── non-breaking routes identical in both versions ─────────────────────────

  describe('non-breaking routes coexist in both versions', () => {
    const routes = ['/users', '/medical-records', '/appointments', '/medications', '/analytics'];

    for (const route of routes) {
      it(`GET /api/v1${route} and /api/v2${route} both return 200`, async () => {
        const [v1, v2] = await Promise.all([
          get(port, `/api/v1${route}`),
          get(port, `/api/v2${route}`),
        ]);
        expect(v1.status).toBe(200);
        expect(v2.status).toBe(200);
      });
    }
  });

  // ── 404 for unknown routes ─────────────────────────────────────────────────

  describe('unknown routes', () => {
    it('returns 404 for unknown path', async () => {
      const res = await get(port, '/api/v99/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
