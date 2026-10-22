import fetch from 'node-fetch';
import request from 'supertest';

import { UserRole } from '../../../models/UserRole';
import { createApp } from '../../app';
import { store } from '../../store';

// ─── Mock node-fetch (provider token exchange) ────────────────────────────────

jest.mock('node-fetch');
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

// ─── Mock pkce-challenge ──────────────────────────────────────────────────────

jest.mock('pkce-challenge', () =>
  jest.fn().mockResolvedValue({
    code_verifier: 'test_verifier_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    code_challenge: 'test_challenge_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  }),
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const app = createApp();

const OWNER_ID = 'oauth-owner-1';
const OTHER_ID = 'oauth-other-1';

function auth(userId: string) {
  return { Authorization: `Bearer mock-${userId}` };
}

function makeUser(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@test.com`,
    name: 'Test User',
    role: UserRole.OWNER,
    pets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isEmailVerified: true,
    twoFactorEnabled: false,
    ...extra,
  };
}

function googleTokenResponse(sub = 'google-sub-123', email = 'user@gmail.com', name = 'Test User') {
  // id_token is a fake JWT with the right payload
  const payload = Buffer.from(JSON.stringify({ sub, email, name })).toString('base64');
  const fakeJwt = `header.${payload}.sig`;
  return {
    ok: true,
    json: async () => ({ id_token: fakeJwt, access_token: 'goog_access' }),
  } as unknown as ReturnType<typeof fetch>;
}

function appleTokenResponse(sub = 'apple-sub-123', email = 'user@privaterelay.appleid.com') {
  const payload = Buffer.from(JSON.stringify({ sub, email })).toString('base64');
  const fakeJwt = `header.${payload}.sig`;
  return {
    ok: true,
    json: async () => ({ id_token: fakeJwt }),
  } as unknown as ReturnType<typeof fetch>;
}

function facebookTokenResponse(id = 'fb-123', email = 'user@facebook.com', name = 'FB User') {
  return {
    ok: true,
    json: async () => ({ access_token: 'fb_access' }),
  } as unknown as ReturnType<typeof fetch>;
}

function facebookUserResponse(id = 'fb-123', email = 'user@facebook.com', name = 'FB User') {
  return {
    ok: true,
    json: async () => ({ id, email, name }),
  } as unknown as ReturnType<typeof fetch>;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  store.users.clear();
  store.users.set(OWNER_ID, makeUser(OWNER_ID) as any);
  store.users.set(OTHER_ID, makeUser(OTHER_ID) as any);
  jest.clearAllMocks();
});

// ─── PKCE init ────────────────────────────────────────────────────────────────

describe('POST /api/auth/oauth/pkce-init', () => {
  it('returns state, code_challenge, and method', async () => {
    const res = await request(app).post('/api/auth/oauth/pkce-init');
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBeDefined();
    expect(res.body.data.code_challenge).toBeDefined();
    expect(res.body.data.code_challenge_method).toBe('S256');
  });

  it('returns unique state on each call', async () => {
    const r1 = await request(app).post('/api/auth/oauth/pkce-init');
    const r2 = await request(app).post('/api/auth/oauth/pkce-init');
    expect(r1.body.data.state).not.toBe(r2.body.data.state);
  });
});

// ─── Google OAuth ─────────────────────────────────────────────────────────────

describe('POST /api/auth/oauth/google', () => {
  async function getState() {
    const r = await request(app).post('/api/auth/oauth/pkce-init');
    return r.body.data.state as string;
  }

  it('creates a new account on first Google login', async () => {
    mockFetch.mockResolvedValueOnce(googleTokenResponse());
    const state = await getState();
    const res = await request(app)
      .post('/api/auth/oauth/google')
      .send({ code: 'auth_code_123', state });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.user.email).toBe('user@gmail.com');
  });

  it('returns existing account on subsequent Google login', async () => {
    mockFetch.mockResolvedValue(googleTokenResponse());

    const state1 = await getState();
    const first = await request(app)
      .post('/api/auth/oauth/google')
      .send({ code: 'code1', state: state1 });
    const userId = first.body.data.user.id;

    const state2 = await getState();
    const second = await request(app)
      .post('/api/auth/oauth/google')
      .send({ code: 'code2', state: state2 });

    expect(second.body.data.user.id).toBe(userId);
  });

  it('links Google to existing email account', async () => {
    // User already exists with same email
    store.users.set('existing-user', makeUser('existing-user', { email: 'user@gmail.com' }) as any);
    mockFetch.mockResolvedValueOnce(googleTokenResponse('new-sub', 'user@gmail.com'));

    const state = await getState();
    const res = await request(app).post('/api/auth/oauth/google').send({ code: 'code', state });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe('existing-user');
  });

  it('rejects invalid state', async () => {
    const res = await request(app)
      .post('/api/auth/oauth/google')
      .send({ code: 'code', state: 'invalid-state' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('rejects missing code', async () => {
    const state = await getState();
    const res = await request(app).post('/api/auth/oauth/google').send({ state });
    expect(res.status).toBe(400);
  });

  it('returns 401 when provider exchange fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) } as any);
    const state = await getState();
    const res = await request(app).post('/api/auth/oauth/google').send({ code: 'bad_code', state });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('OAUTH_EXCHANGE_FAILED');
  });

  it('rejects unknown provider', async () => {
    const state = await getState();
    const res = await request(app).post('/api/auth/oauth/twitter').send({ code: 'code', state });
    expect(res.status).toBe(400);
  });

  it('state is single-use — rejects reuse', async () => {
    mockFetch.mockResolvedValue(googleTokenResponse());
    const state = await getState();
    await request(app).post('/api/auth/oauth/google').send({ code: 'code1', state });
    const res = await request(app).post('/api/auth/oauth/google').send({ code: 'code2', state });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });
});

// ─── Apple OAuth ──────────────────────────────────────────────────────────────

describe('POST /api/auth/oauth/apple', () => {
  it('creates account from Apple id_token', async () => {
    mockFetch.mockResolvedValueOnce(appleTokenResponse());
    const r = await request(app).post('/api/auth/oauth/pkce-init');
    const res = await request(app)
      .post('/api/auth/oauth/apple')
      .send({ code: 'apple_code', state: r.body.data.state, name: 'Apple User' });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
  });

  it('returns 401 when Apple exchange fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) } as any);
    const r = await request(app).post('/api/auth/oauth/pkce-init');
    const res = await request(app)
      .post('/api/auth/oauth/apple')
      .send({ code: 'bad', state: r.body.data.state });
    expect(res.status).toBe(401);
  });
});

// ─── Facebook OAuth ───────────────────────────────────────────────────────────

describe('POST /api/auth/oauth/facebook', () => {
  it('creates account from Facebook token', async () => {
    mockFetch
      .mockResolvedValueOnce(facebookTokenResponse())
      .mockResolvedValueOnce(facebookUserResponse());
    const r = await request(app).post('/api/auth/oauth/pkce-init');
    const res = await request(app)
      .post('/api/auth/oauth/facebook')
      .send({ code: 'fb_code', state: r.body.data.state });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('user@facebook.com');
  });
});

// ─── Token refresh ────────────────────────────────────────────────────────────

describe('POST /api/auth/oauth/refresh', () => {
  it('issues new access + refresh tokens', async () => {
    mockFetch.mockResolvedValue(googleTokenResponse());
    const r = await request(app).post('/api/auth/oauth/pkce-init');
    const login = await request(app)
      .post('/api/auth/oauth/google')
      .send({ code: 'code', state: r.body.data.state });
    const { refreshToken } = login.body.data;

    const res = await request(app).post('/api/auth/oauth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    // Rotation: new refresh token must differ
    expect(res.body.data.refreshToken).not.toBe(refreshToken);
  });

  it('rejects missing refreshToken', async () => {
    const res = await request(app).post('/api/auth/oauth/refresh').send({});
    expect(res.status).toBe(400);
  });

  it('rejects invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/oauth/refresh')
      .send({ refreshToken: 'not.a.jwt' });
    expect(res.status).toBe(401);
  });

  it('rejects reused refresh token (rotation)', async () => {
    mockFetch.mockResolvedValue(googleTokenResponse());
    const r = await request(app).post('/api/auth/oauth/pkce-init');
    const login = await request(app)
      .post('/api/auth/oauth/google')
      .send({ code: 'code', state: r.body.data.state });
    const { refreshToken } = login.body.data;

    // Use it once
    await request(app).post('/api/auth/oauth/refresh').send({ refreshToken });
    // Reuse should fail
    const res = await request(app).post('/api/auth/oauth/refresh').send({ refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_REVOKED');
  });
});

// ─── Token revocation ─────────────────────────────────────────────────────────

describe('POST /api/auth/oauth/revoke', () => {
  it('revokes a refresh token', async () => {
    mockFetch.mockResolvedValue(googleTokenResponse());
    const r = await request(app).post('/api/auth/oauth/pkce-init');
    const login = await request(app)
      .post('/api/auth/oauth/google')
      .send({ code: 'code', state: r.body.data.state });
    const { refreshToken, user } = login.body.data;

    const res = await request(app)
      .post('/api/auth/oauth/revoke')
      .set(auth(user.id))
      .send({ refreshToken });
    expect(res.status).toBe(200);

    // Revoked token should no longer refresh
    const refresh = await request(app).post('/api/auth/oauth/refresh').send({ refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/auth/oauth/revoke').send({ refreshToken: 'token' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing refreshToken', async () => {
    const res = await request(app).post('/api/auth/oauth/revoke').set(auth(OWNER_ID)).send({});
    expect(res.status).toBe(400);
  });
});

// ─── Provider listing ─────────────────────────────────────────────────────────

describe('GET /api/auth/oauth/providers', () => {
  it('returns linked providers', async () => {
    store.users.set(
      OWNER_ID,
      makeUser(OWNER_ID, {
        oauthIdentities: [
          { provider: 'google', providerUserId: 'g-123', linkedAt: new Date().toISOString() },
        ],
      }) as any,
    );

    const res = await request(app).get('/api/auth/oauth/providers').set(auth(OWNER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.linked[0].provider).toBe('google');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/auth/oauth/providers');
    expect(res.status).toBe(401);
  });
});

// ─── Account linking ──────────────────────────────────────────────────────────

describe('POST /api/auth/oauth/link', () => {
  it('links a new provider to existing account', async () => {
    mockFetch.mockResolvedValueOnce(googleTokenResponse('new-google-sub', 'other@gmail.com'));
    const r = await request(app).post('/api/auth/oauth/pkce-init');
    const res = await request(app)
      .post('/api/auth/oauth/link')
      .set(auth(OWNER_ID))
      .send({ provider: 'google', code: 'code', state: r.body.data.state });
    expect(res.status).toBe(200);
  });

  it('prevents linking a provider already linked to another account', async () => {
    // OTHER_ID already has this Google identity
    store.users.set(
      OTHER_ID,
      makeUser(OTHER_ID, {
        oauthIdentities: [
          { provider: 'google', providerUserId: 'taken-sub', linkedAt: new Date().toISOString() },
        ],
      }) as any,
    );

    mockFetch.mockResolvedValueOnce(googleTokenResponse('taken-sub', 'taken@gmail.com'));
    const r = await request(app).post('/api/auth/oauth/pkce-init');
    const res = await request(app)
      .post('/api/auth/oauth/link')
      .set(auth(OWNER_ID))
      .send({ provider: 'google', code: 'code', state: r.body.data.state });
    expect(res.status).toBe(409);
  });

  it('rejects unknown provider', async () => {
    const r = await request(app).post('/api/auth/oauth/pkce-init');
    const res = await request(app)
      .post('/api/auth/oauth/link')
      .set(auth(OWNER_ID))
      .send({ provider: 'twitter', code: 'code', state: r.body.data.state });
    expect(res.status).toBe(400);
  });
});

// ─── Account unlinking ────────────────────────────────────────────────────────

describe('DELETE /api/auth/oauth/unlink/:provider', () => {
  it('unlinks a provider when another login method exists', async () => {
    store.users.set(
      OWNER_ID,
      makeUser(OWNER_ID, {
        passwordHash: '$2b$10$hash',
        oauthIdentities: [
          { provider: 'google', providerUserId: 'g-123', linkedAt: new Date().toISOString() },
        ],
      }) as any,
    );

    const res = await request(app).delete('/api/auth/oauth/unlink/google').set(auth(OWNER_ID));
    expect(res.status).toBe(200);
  });

  it('prevents unlinking the only login method', async () => {
    store.users.set(
      OWNER_ID,
      makeUser(OWNER_ID, {
        oauthIdentities: [
          { provider: 'google', providerUserId: 'g-123', linkedAt: new Date().toISOString() },
        ],
      }) as any,
    );

    const res = await request(app).delete('/api/auth/oauth/unlink/google').set(auth(OWNER_ID));
    expect(res.status).toBe(400);
  });

  it('rejects unknown provider', async () => {
    const res = await request(app).delete('/api/auth/oauth/unlink/twitter').set(auth(OWNER_ID));
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/api/auth/oauth/unlink/google');
    expect(res.status).toBe(401);
  });
});
