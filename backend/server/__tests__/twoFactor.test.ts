import request from 'supertest';

import { UserRole } from '../../models/UserRole';
import { createApp } from '../app';
import { store } from '../store';

const app = createApp();

const makeUser = (overrides = {}) => ({
  id: 'user-2fa',
  email: 'user@petchain.app',
  name: 'Test User',
  role: UserRole.OWNER,
  pets: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isEmailVerified: true,
  twoFactorEnabled: false,
  ...overrides,
});

const authHeader = (id = 'user-2fa') => ({ Authorization: `Bearer mock-${id}` });

beforeEach(() => {
  store.users.clear();
  store.users.set('user-2fa', makeUser());
});

// ── Setup ──────────────────────────────────────────────────────────────────

describe('POST /api/auth/2fa/setup', () => {
  it('returns qrCode and secret', async () => {
    const res = await request(app).post('/api/auth/2fa/setup').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      qrCode: expect.stringContaining('data:image'),
      secret: expect.any(String),
    });
    // Pending secret stored on user
    expect(store.users.get('user-2fa')?.twoFactorPendingSecret).toBeTruthy();
  });

  it('returns 409 when 2FA already enabled', async () => {
    store.users.set('user-2fa', makeUser({ twoFactorEnabled: true, twoFactorSecret: 'S' }));
    const res = await request(app).post('/api/auth/2fa/setup').set(authHeader());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/auth/2fa/setup');
    expect(res.status).toBe(401);
  });
});

// ── Verify-setup ───────────────────────────────────────────────────────────

describe('POST /api/auth/2fa/verify-setup', () => {
  it('returns 400 when no pending setup', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/verify-setup')
      .set(authHeader())
      .send({ token: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for missing token', async () => {
    store.users.set('user-2fa', makeUser({ twoFactorPendingSecret: 'JBSWY3DPEHPK3PXP' }));
    const res = await request(app).post('/api/auth/2fa/verify-setup').set(authHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid TOTP code', async () => {
    store.users.set('user-2fa', makeUser({ twoFactorPendingSecret: 'JBSWY3DPEHPK3PXP' }));
    const res = await request(app)
      .post('/api/auth/2fa/verify-setup')
      .set(authHeader())
      .send({ token: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

// ── Verify (login step) ────────────────────────────────────────────────────

describe('POST /api/auth/2fa/verify', () => {
  it('returns 400 when 2FA not enabled', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/verify')
      .set(authHeader())
      .send({ token: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for missing token', async () => {
    store.users.set('user-2fa', makeUser({ twoFactorEnabled: true, twoFactorSecret: 'S' }));
    const res = await request(app).post('/api/auth/2fa/verify').set(authHeader()).send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 for invalid TOTP code', async () => {
    store.users.set(
      'user-2fa',
      makeUser({ twoFactorEnabled: true, twoFactorSecret: 'JBSWY3DPEHPK3PXP' }),
    );
    const res = await request(app)
      .post('/api/auth/2fa/verify')
      .set(authHeader())
      .send({ token: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

// ── Disable ────────────────────────────────────────────────────────────────

describe('POST /api/auth/2fa/disable', () => {
  it('returns 400 when 2FA not enabled', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/disable')
      .set(authHeader())
      .send({ token: '123456' });
    expect(res.status).toBe(400);
  });

  it('returns 403 for admin accounts', async () => {
    store.users.set(
      'user-2fa',
      makeUser({ role: UserRole.ADMIN, twoFactorEnabled: true, twoFactorSecret: 'S' }),
    );
    const res = await request(app)
      .post('/api/auth/2fa/disable')
      .set(authHeader())
      .send({ token: '123456' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 401 for invalid TOTP code', async () => {
    store.users.set(
      'user-2fa',
      makeUser({ twoFactorEnabled: true, twoFactorSecret: 'JBSWY3DPEHPK3PXP' }),
    );
    const res = await request(app)
      .post('/api/auth/2fa/disable')
      .set(authHeader())
      .send({ token: '000000' });
    expect(res.status).toBe(401);
  });
});

// ── Backup-verify ──────────────────────────────────────────────────────────

describe('POST /api/auth/2fa/backup-verify', () => {
  it('returns 400 when 2FA not enabled', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/backup-verify')
      .set(authHeader())
      .send({ code: 'ABCD1234EF' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing code', async () => {
    store.users.set(
      'user-2fa',
      makeUser({ twoFactorEnabled: true, twoFactorBackupCodes: ['$2a$10$x'] }),
    );
    const res = await request(app).post('/api/auth/2fa/backup-verify').set(authHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 for invalid backup code', async () => {
    store.users.set(
      'user-2fa',
      makeUser({ twoFactorEnabled: true, twoFactorBackupCodes: ['$2a$10$invalidhash'] }),
    );
    const res = await request(app)
      .post('/api/auth/2fa/backup-verify')
      .set(authHeader())
      .send({ code: 'WRONGCODE1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CODE');
  });
});

// ── Backup-regenerate ──────────────────────────────────────────────────────

describe('POST /api/auth/2fa/backup-regenerate', () => {
  it('returns 400 when 2FA not enabled', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/backup-regenerate')
      .set(authHeader())
      .send({ token: '123456' });
    expect(res.status).toBe(400);
  });

  it('returns 401 for invalid TOTP code', async () => {
    store.users.set(
      'user-2fa',
      makeUser({ twoFactorEnabled: true, twoFactorSecret: 'JBSWY3DPEHPK3PXP' }),
    );
    const res = await request(app)
      .post('/api/auth/2fa/backup-regenerate')
      .set(authHeader())
      .send({ token: '000000' });
    expect(res.status).toBe(401);
  });
});

// ── Recovery ───────────────────────────────────────────────────────────────

describe('POST /api/auth/2fa/recovery/request', () => {
  it('returns 200 even for unknown email (anti-enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/recovery/request')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
  });

  it('returns 400 for missing email', async () => {
    const res = await request(app).post('/api/auth/2fa/recovery/request').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('issues a recovery token for a user with 2FA enabled', async () => {
    store.users.set('user-2fa', makeUser({ twoFactorEnabled: true, twoFactorSecret: 'S' }));
    const res = await request(app)
      .post('/api/auth/2fa/recovery/request')
      .send({ email: 'user@petchain.app' });
    expect(res.status).toBe(200);
    expect(res.body.data.recoveryToken).toBeTruthy();
    expect(store.users.get('user-2fa')?.recoveryToken).toBeTruthy();
  });
});

describe('POST /api/auth/2fa/recovery/verify', () => {
  it('returns 400 for missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/recovery/verify')
      .send({ email: 'user@petchain.app' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/recovery/verify')
      .send({ email: 'user@petchain.app', token: 'badtoken' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('disables 2FA on valid recovery token', async () => {
    // Request a token first
    store.users.set('user-2fa', makeUser({ twoFactorEnabled: true, twoFactorSecret: 'S' }));
    const reqRes = await request(app)
      .post('/api/auth/2fa/recovery/request')
      .send({ email: 'user@petchain.app' });
    const { recoveryToken } = reqRes.body.data;

    const verifyRes = await request(app)
      .post('/api/auth/2fa/recovery/verify')
      .send({ email: 'user@petchain.app', token: recoveryToken });
    expect(verifyRes.status).toBe(200);
    expect(store.users.get('user-2fa')?.twoFactorEnabled).toBe(false);
    expect(store.users.get('user-2fa')?.twoFactorSecret).toBeUndefined();
  });
});
