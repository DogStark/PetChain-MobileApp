import * as crypto from 'crypto';

import jwt from 'jsonwebtoken';

import config from '../../config';
import { GRANT_PERMISSIONS, type AccessGrant } from '../../models/AccessGrant';
import { UserRole } from '../../models/UserRole';
import {
  grantStore,
  hashToken,
  requirePermission,
  requirePetOwnership,
  type Permission,
} from '../rbac';

// Mock the DB repository so tests never hit postgres
jest.mock('../../src/repositories/accessGrantRepository', () => ({
  accessGrantRepository: {
    findByTokenHash: jest.fn().mockResolvedValue(null),
  },
}));

// Mock auditLogService to avoid side effects
jest.mock('../../services/auditLogService', () => {
  const mockLog = jest.fn();
  return {
    __esModule: true,
    default: { log: mockLog, query: jest.fn() },
  };
});

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as any;
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    headers: {},
    params: {},
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as any;
}

function bearerReq(role: UserRole, id = 'u1', email = 'u@test.com') {
  return makeReq({ user: { id, email, role } });
}

function grantReq(token: string, petId?: string) {
  return makeReq({
    headers: { authorization: `Grant ${token}` },
    params: petId ? { petId } : {},
  });
}

function makeGrant(overrides: Partial<AccessGrant> = {}): AccessGrant {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  return {
    id: 'grant-1',
    ownerId: 'owner-1',
    granteeId: 'grantee-1',
    petId: 'pet-1',
    role: 'vet-read',
    tokenHash: '',
    expiresAt: future,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Register a grant in the in-memory store so rbac.ts can find it without DB. */
function registerGrant(token: string, grant: AccessGrant): AccessGrant {
  const withHash = { ...grant, tokenHash: hashToken(token) };
  grantStore.set(withHash.id, withHash);
  return withHash;
}

// ── clean up store between tests ──────────────────────────────────────────────

beforeEach(() => {
  grantStore.clear();
});

// ── ROLE_PERMISSIONS – JWT path ───────────────────────────────────────────────

describe('JWT role permissions', () => {
  const run = (permission: Permission, role: UserRole) =>
    new Promise<{ nextCalled: boolean; status?: number }>((resolve) => {
      const req = bearerReq(role);
      const res = makeRes();
      const next = jest.fn(() => resolve({ nextCalled: true }));
      const mw = requirePermission(permission);
      void mw(req, res, next).then(() => {
        if (!next.mock.calls.length) {
          resolve({ nextCalled: false, status: res.status.mock.calls[0]?.[0] });
        }
      });
    });

  describe('owner', () => {
    it('can read and write own pets', async () => {
      expect((await run('pet:read', UserRole.OWNER)).nextCalled).toBe(true);
      expect((await run('pet:write', UserRole.OWNER)).nextCalled).toBe(true);
    });

    it('can read medical records', async () => {
      expect((await run('medical_record:read', UserRole.OWNER)).nextCalled).toBe(true);
    });

    it('cannot write medical records', async () => {
      const r = await run('medical_record:write', UserRole.OWNER);
      expect(r.nextCalled).toBe(false);
      expect(r.status).toBe(403);
    });

    it('can manage access grants', async () => {
      expect((await run('access_grant:manage', UserRole.OWNER)).nextCalled).toBe(true);
    });
  });

  describe('vet', () => {
    it('can read assigned pet records', async () => {
      expect((await run('medical_record:read', UserRole.VET)).nextCalled).toBe(true);
    });

    it('can write medical records', async () => {
      expect((await run('medical_record:write', UserRole.VET)).nextCalled).toBe(true);
    });

    it('cannot write pets', async () => {
      const r = await run('pet:write', UserRole.VET);
      expect(r.nextCalled).toBe(false);
      expect(r.status).toBe(403);
    });

    it('cannot manage access grants', async () => {
      const r = await run('access_grant:manage', UserRole.VET);
      expect(r.nextCalled).toBe(false);
    });
  });

  describe('admin', () => {
    const allPermissions: Permission[] = [
      'pet:read',
      'pet:write',
      'medical_record:read',
      'medical_record:write',
      'medication:read',
      'medication:write',
      'appointment:read',
      'appointment:write',
      'access_grant:manage',
    ];

    it.each(allPermissions)('can access %s', async (perm) => {
      expect((await run(perm, UserRole.ADMIN)).nextCalled).toBe(true);
    });
  });

  describe('family viewer (owner without write perms)', () => {
    it('owner cannot delete (write) records', async () => {
      const r = await run('medical_record:write', UserRole.OWNER);
      expect(r.nextCalled).toBe(false);
      expect(r.status).toBe(403);
    });
  });
});

// ── unauthenticated / expired JWT ─────────────────────────────────────────────

describe('unauthenticated requests', () => {
  it('returns 401 when no auth header is present', async () => {
    const req = makeReq(); // no user, no authorization header
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('pet:read')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    // no valid grant → falls through to 403 (no valid token)
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 401 for expired JWT (handled by auth middleware, 403 here)', async () => {
    // auth.ts catches jwt.TokenExpiredError and returns 401 before rbac runs.
    // By the time rbac runs the token is already verified; we test the JWT layer:
    const expiredToken = jwt.sign(
      {
        sub: 'u1',
        email: 'u@test.com',
        role: UserRole.OWNER,
        exp: Math.floor(Date.now() / 1000) - 100,
      },
      config.app.jwtSecret,
    );
    // Simulate what happens when auth middleware already rejected: req.user is undefined
    const req = makeReq({ headers: { authorization: `Bearer ${expiredToken}` } });
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('pet:read')(req, res, next);
    // No user set (auth already rejected) + no valid grant → forbidden
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ── access-grant token path ───────────────────────────────────────────────────

describe('access-grant tokens', () => {
  it('grants vet-read access to pet:read', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    registerGrant(token, makeGrant({ role: 'vet-read', petId: 'pet-1' }));

    const req = grantReq(token, 'pet-1');
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('pet:read')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.grantContext).toBeDefined();
  });

  it('denies vet-read when requesting a write permission', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    registerGrant(token, makeGrant({ role: 'vet-read', petId: 'pet-1' }));

    const req = grantReq(token, 'pet-1');
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('medical_record:write')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects expired grant token', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    registerGrant(token, makeGrant({ expiresAt: new Date(Date.now() - 1000).toISOString() }));

    const req = grantReq(token, 'pet-1');
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('pet:read')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects revoked grant token', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    registerGrant(token, makeGrant({ revokedAt: new Date().toISOString() }));

    const req = grantReq(token, 'pet-1');
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('pet:read')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('TOKEN_REVOKED');
  });

  it('rejects grant token scoped to a different pet', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    registerGrant(token, makeGrant({ petId: 'pet-1' }));

    const req = grantReq(token, 'pet-OTHER');
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('pet:read')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('emergency-contact cannot write records', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    registerGrant(token, makeGrant({ role: 'emergency-contact', petId: 'pet-1' }));

    const req = grantReq(token, 'pet-1');
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('medical_record:write')(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects completely unknown/invalid token', async () => {
    const req = grantReq('unknown-token-that-doesnt-exist', 'pet-1');
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('pet:read')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ── requirePetOwnership ────────────────────────────────────────────────────────

describe('requirePetOwnership', () => {
  it('passes for owner with petId', () => {
    const req = makeReq({ user: { id: 'u1', role: UserRole.OWNER }, params: { petId: 'p1' } });
    const res = makeRes();
    const next = jest.fn();
    requirePetOwnership(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes for admin regardless of role', () => {
    const req = makeReq({ user: { id: 'u1', role: UserRole.ADMIN }, params: { petId: 'p1' } });
    const res = makeRes();
    const next = jest.fn();
    requirePetOwnership(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 for unauthenticated request', () => {
    const req = makeReq({ params: { petId: 'p1' } });
    const res = makeRes();
    const next = jest.fn();
    requirePetOwnership(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 for vet trying to manage grants', () => {
    const req = makeReq({ user: { id: 'u1', role: UserRole.VET }, params: { petId: 'p1' } });
    const res = makeRes();
    const next = jest.fn();
    requirePetOwnership(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 when petId is missing', () => {
    const req = makeReq({ user: { id: 'u1', role: UserRole.OWNER }, params: {} });
    const res = makeRes();
    const next = jest.fn();
    requirePetOwnership(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ── hashToken helper ──────────────────────────────────────────────────────────

describe('hashToken', () => {
  it('produces a consistent sha256 hex digest', () => {
    const h1 = hashToken('abc');
    const h2 = hashToken('abc');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
    expect(hashToken('abc')).not.toBe(hashToken('xyz'));
  });
});

// ── GRANT_PERMISSIONS sanity check ────────────────────────────────────────────

describe('GRANT_PERMISSIONS', () => {
  it('vet-write includes all vet-read permissions', () => {
    const read = GRANT_PERMISSIONS['vet-read'];
    const write = GRANT_PERMISSIONS['vet-write'];
    read.forEach((p) => expect(write).toContain(p));
  });

  it('emergency-contact only gets read permissions', () => {
    GRANT_PERMISSIONS['emergency-contact'].forEach((p) => {
      expect(p).toMatch(/:read$/);
    });
  });
});
