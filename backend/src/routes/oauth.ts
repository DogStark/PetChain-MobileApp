/**
 * OAuth 2.0 backend routes — token exchange, account linking, refresh, revocation.
 * Client secrets NEVER leave the backend. The mobile app only sends authorization codes.
 */
import { randomUUID } from 'crypto';

import express from 'express';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import pkceChallenge from 'pkce-challenge';

import backendConfig from '../../config';
import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import { ok, sendError } from '../../server/response';
import { store } from '../../server/store';
import logger from '../../utils/logger';

const router = express.Router();

// ─── Types ────────────────────────────────────────────────────────────────────

export type OAuthProvider = 'google' | 'apple' | 'facebook';

interface OAuthIdentity {
  provider: OAuthProvider;
  providerUserId: string;
  email?: string;
  linkedAt: string;
}

// Extend store users with OAuth fields (in-memory only)
interface OAuthStoredUser {
  oauthIdentities?: OAuthIdentity[];
  refreshTokenHash?: string;
  revokedTokens?: string[]; // jti list
}

// ─── PKCE state store (in-memory, keyed by state param) ──────────────────────

const pkceStore = new Map<string, { codeVerifier: string; expiresAt: number }>();

// Clean up expired entries every 5 min
setInterval(
  () => {
    const now = Date.now();
    for (const [k, v] of pkceStore) {
      if (v.expiresAt < now) pkceStore.delete(k);
    }
  },
  5 * 60 * 1000,
);

// ─── Config (secrets from env — never sent to client) ────────────────────────

const OAUTH_CONFIG = {
  google: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'https://auth.expo.io/@petchain/petchain',
  },
  apple: {
    tokenUrl: 'https://appleid.apple.com/auth/token',
    clientId: process.env.APPLE_CLIENT_ID ?? '',
    clientSecret: process.env.APPLE_CLIENT_SECRET ?? '', // signed JWT from Apple
    redirectUri: process.env.APPLE_REDIRECT_URI ?? 'https://auth.expo.io/@petchain/petchain',
  },
  facebook: {
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/me?fields=id,email,name',
    clientId: process.env.FACEBOOK_APP_ID ?? '',
    clientSecret: process.env.FACEBOOK_APP_SECRET ?? '',
    redirectUri: process.env.FACEBOOK_REDIRECT_URI ?? 'https://auth.expo.io/@petchain/petchain',
  },
} as const;

// ─── JWT helpers ──────────────────────────────────────────────────────────────

const JWT_SECRET = backendConfig.app.jwtSecret;
const ACCESS_TTL = '1h';
const REFRESH_TTL = '30d';

function issueAccessToken(userId: string, email: string, role: UserRole): string {
  return jwt.sign({ sub: userId, email, role, jti: randomUUID() }, JWT_SECRET, {
    expiresIn: ACCESS_TTL,
  });
}

function issueRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh', jti: randomUUID() }, JWT_SECRET, {
    expiresIn: REFRESH_TTL,
  });
}

function getUserOAuth(userId: string): OAuthStoredUser {
  return (store.users.get(userId) as OAuthStoredUser | undefined) ?? ({} as OAuthStoredUser);
}

function patchUser(userId: string, patch: Partial<OAuthStoredUser>): void {
  const user = store.users.get(userId);
  if (!user) return;
  store.users.set(userId, { ...user, ...(patch as object) });
}

// ─── Provider token exchange ──────────────────────────────────────────────────

async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
): Promise<{ providerUserId: string; email: string; name: string }> {
  const cfg = OAUTH_CONFIG.google;
  const params = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });

  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!tokenRes.ok) throw new Error('Google token exchange failed');
  const tokenData = (await tokenRes.json()) as { id_token?: string; access_token?: string };

  // Decode id_token to get user info (already verified by Google's endpoint)
  if (tokenData.id_token) {
    const payload = jwt.decode(tokenData.id_token) as { sub: string; email: string; name: string };
    return { providerUserId: payload.sub, email: payload.email, name: payload.name };
  }

  // Fallback: userinfo endpoint
  const userRes = await fetch(cfg.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const user = (await userRes.json()) as { sub: string; email: string; name: string };
  return { providerUserId: user.sub, email: user.email, name: user.name };
}

async function exchangeAppleCode(
  code: string,
  codeVerifier: string,
): Promise<{ providerUserId: string; email?: string; name?: string }> {
  const cfg = OAUTH_CONFIG.apple;
  const params = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });

  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!tokenRes.ok) throw new Error('Apple token exchange failed');
  const tokenData = (await tokenRes.json()) as { id_token?: string };
  if (!tokenData.id_token) throw new Error('Apple did not return id_token');

  const payload = jwt.decode(tokenData.id_token) as { sub: string; email?: string };
  return { providerUserId: payload.sub, email: payload.email };
}

async function exchangeFacebookCode(
  code: string,
  codeVerifier: string,
): Promise<{ providerUserId: string; email: string; name: string }> {
  const cfg = OAUTH_CONFIG.facebook;
  const params = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    code_verifier: codeVerifier,
  });

  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'GET',
    // Facebook uses GET for token exchange
  });
  const tokenUrl = `${cfg.tokenUrl}?${params.toString()}`;
  const tRes = await fetch(tokenUrl);
  if (!tRes.ok) throw new Error('Facebook token exchange failed');
  const tokenData = (await tRes.json()) as { access_token?: string };
  if (!tokenData.access_token) throw new Error('Facebook did not return access_token');

  const userRes = await fetch(`${cfg.userInfoUrl}&access_token=${tokenData.access_token}`);
  const user = (await userRes.json()) as { id: string; email: string; name: string };
  return { providerUserId: user.id, email: user.email, name: user.name };
}

async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  codeVerifier: string,
): Promise<{ providerUserId: string; email?: string; name?: string }> {
  switch (provider) {
    case 'google':
      return exchangeGoogleCode(code, codeVerifier);
    case 'apple':
      return exchangeAppleCode(code, codeVerifier);
    case 'facebook':
      return exchangeFacebookCode(code, codeVerifier);
  }
}

// ─── Account resolution (link or create) ─────────────────────────────────────

function findByOAuthIdentity(provider: OAuthProvider, providerUserId: string) {
  return [...store.users.values()].find((u) =>
    ((u as unknown as OAuthStoredUser).oauthIdentities ?? []).some(
      (id) => id.provider === provider && id.providerUserId === providerUserId,
    ),
  );
}

function findByEmail(email: string) {
  return [...store.users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
}

// ─── POST /api/auth/oauth/pkce-init ──────────────────────────────────────────
// Returns a code_challenge for the client to use in the authorization URL.
// The code_verifier is stored server-side keyed by a state param.
router.post('/oauth/pkce-init', async (_req, res) => {
  const { code_verifier, code_challenge } = await pkceChallenge();
  const state = randomUUID();
  pkceStore.set(state, { codeVerifier: code_verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
  return res.json(ok({ state, code_challenge, code_challenge_method: 'S256' }));
});

// ─── POST /api/auth/oauth/:provider ──────────────────────────────────────────
// Receives authorization code + state from client, exchanges for tokens server-side.
router.post('/oauth/:provider', async (req, res) => {
  const provider = req.params.provider as OAuthProvider;
  if (!['google', 'apple', 'facebook'].includes(provider)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Unknown provider');
  }

  const {
    code,
    state,
    name: clientName,
  } = req.body as {
    code?: string;
    state?: string;
    name?: string; // Apple sends name only on first login
  };

  if (!code?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'code is required');
  if (!state?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'state is required');

  const pkceEntry = pkceStore.get(state);
  if (!pkceEntry || pkceEntry.expiresAt < Date.now()) {
    return sendError(res, 400, 'INVALID_STATE', 'Invalid or expired state parameter');
  }
  pkceStore.delete(state); // single-use

  let providerInfo: { providerUserId: string; email?: string; name?: string };
  try {
    providerInfo = await exchangeCode(provider, code, pkceEntry.codeVerifier);
  } catch (err) {
    logger.warn('oauth_exchange_failed', {
      provider,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return sendError(res, 401, 'OAUTH_EXCHANGE_FAILED', 'Authorization code exchange failed');
  }

  const { providerUserId, email, name } = providerInfo;
  const resolvedName = clientName ?? name ?? email?.split('@')[0] ?? 'User';

  // 1. Find existing account by provider identity
  let user = findByOAuthIdentity(provider, providerUserId);

  // 2. Find by email (safe merge — only if email is verified by provider)
  if (!user && email) {
    user = findByEmail(email);
    if (user) {
      // Link this provider to the existing account
      const existing = (user as unknown as OAuthStoredUser).oauthIdentities ?? [];
      patchUser(user.id, {
        oauthIdentities: [
          ...existing,
          { provider, providerUserId, email, linkedAt: new Date().toISOString() },
        ],
      });
      logger.info('oauth_account_linked', { userId: user.id, provider });
    }
  }

  // 3. Create new account
  if (!user) {
    const t = new Date().toISOString();
    const newUser = {
      id: randomUUID(),
      email: email ?? `${provider}_${providerUserId}@oauth.petchain.app`,
      name: resolvedName,
      role: UserRole.OWNER,
      pets: [],
      createdAt: t,
      updatedAt: t,
      isEmailVerified: !!email,
      twoFactorEnabled: false,
      oauthIdentities: [{ provider, providerUserId, email, linkedAt: t }] as OAuthIdentity[],
    };
    store.users.set(
      newUser.id,
      newUser as unknown as typeof store.users extends Map<string, infer V> ? V : never,
    );
    user = store.users.get(newUser.id)!;
    logger.info('oauth_account_created', { userId: user.id, provider });
  }

  const accessToken = issueAccessToken(user.id, user.email, user.role);
  const refreshToken = issueRefreshToken(user.id);
  patchUser(user.id, { refreshTokenHash: refreshToken });

  return res.json(
    ok({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token: accessToken,
      refreshToken,
      expiresIn: 3600,
    }),
  );
});

// ─── POST /api/auth/oauth/refresh ─────────────────────────────────────────────
router.post('/oauth/refresh', (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) return sendError(res, 400, 'VALIDATION_ERROR', 'refreshToken is required');

  let payload: { sub: string; type?: string; jti?: string };
  try {
    payload = jwt.verify(refreshToken, JWT_SECRET) as typeof payload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return sendError(res, 401, 'TOKEN_EXPIRED', 'Refresh token expired');
    }
    return sendError(res, 401, 'INVALID_TOKEN', 'Invalid refresh token');
  }

  if (payload.type !== 'refresh')
    return sendError(res, 401, 'INVALID_TOKEN', 'Not a refresh token');

  const user = store.users.get(payload.sub);
  if (!user) return sendError(res, 401, 'INVALID_TOKEN', 'User not found');

  // Check token hasn't been revoked
  const oauthUser = user as unknown as OAuthStoredUser;
  if (payload.jti && oauthUser.revokedTokens?.includes(payload.jti)) {
    return sendError(res, 401, 'TOKEN_REVOKED', 'Refresh token has been revoked');
  }

  // Rotation: revoke old, issue new
  const revokedTokens = [...(oauthUser.revokedTokens ?? []), ...(payload.jti ? [payload.jti] : [])];
  const newRefresh = issueRefreshToken(user.id);
  patchUser(user.id, { refreshTokenHash: newRefresh, revokedTokens });

  return res.json(
    ok({
      token: issueAccessToken(user.id, user.email, user.role),
      refreshToken: newRefresh,
      expiresIn: 3600,
    }),
  );
});

// ─── POST /api/auth/oauth/revoke ──────────────────────────────────────────────
router.post('/oauth/revoke', authenticateJWT, (req: AuthenticatedRequest, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) return sendError(res, 400, 'VALIDATION_ERROR', 'refreshToken is required');

  let payload: { sub?: string; jti?: string };
  try {
    payload = jwt.verify(refreshToken, JWT_SECRET) as typeof payload;
  } catch {
    // Even if expired, we accept revocation
    try {
      payload = (jwt.decode(refreshToken) as typeof payload) ?? {};
    } catch {
      payload = {};
    }
  }

  if (payload.sub && payload.sub !== req.user!.id) {
    return sendError(res, 403, 'FORBIDDEN', "Cannot revoke another user's token");
  }

  if (payload.jti) {
    const oauthUser = store.users.get(req.user!.id) as unknown as OAuthStoredUser;
    const revokedTokens = [...(oauthUser?.revokedTokens ?? []), payload.jti];
    patchUser(req.user!.id, { revokedTokens });
  }

  logger.info('oauth_token_revoked', { userId: req.user!.id });
  return res.json(ok(null, 'Token revoked'));
});

// ─── GET /api/auth/oauth/providers ───────────────────────────────────────────
router.get('/oauth/providers', authenticateJWT, (req: AuthenticatedRequest, res) => {
  const user = store.users.get(req.user!.id) as unknown as OAuthStoredUser;
  const linked = (user?.oauthIdentities ?? []).map((id) => ({
    provider: id.provider,
    linkedAt: id.linkedAt,
  }));
  return res.json(ok({ linked }));
});

// ─── POST /api/auth/oauth/link ────────────────────────────────────────────────
// Link an additional provider to an already-authenticated account.
router.post('/oauth/link', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  const provider = req.body.provider as OAuthProvider;
  const { code, state } = req.body as { code?: string; state?: string };

  if (!['google', 'apple', 'facebook'].includes(provider)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Unknown provider');
  }
  if (!code?.trim() || !state?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'code and state are required');
  }

  const pkceEntry = pkceStore.get(state);
  if (!pkceEntry || pkceEntry.expiresAt < Date.now()) {
    return sendError(res, 400, 'INVALID_STATE', 'Invalid or expired state');
  }
  pkceStore.delete(state);

  let providerInfo: { providerUserId: string; email?: string };
  try {
    providerInfo = await exchangeCode(provider, code, pkceEntry.codeVerifier);
  } catch {
    return sendError(res, 401, 'OAUTH_EXCHANGE_FAILED', 'Authorization code exchange failed');
  }

  // Prevent takeover: ensure this provider identity isn't already linked to another account
  const existing = findByOAuthIdentity(provider, providerInfo.providerUserId);
  if (existing && existing.id !== req.user!.id) {
    return sendError(
      res,
      409,
      'CONFLICT',
      'This provider account is already linked to another user',
    );
  }

  const user = store.users.get(req.user!.id) as unknown as OAuthStoredUser;
  const identities = user?.oauthIdentities ?? [];
  if (identities.some((id) => id.provider === provider)) {
    return sendError(res, 409, 'CONFLICT', `${provider} is already linked to this account`);
  }

  patchUser(req.user!.id, {
    oauthIdentities: [
      ...identities,
      {
        provider,
        providerUserId: providerInfo.providerUserId,
        email: providerInfo.email,
        linkedAt: new Date().toISOString(),
      },
    ],
  });

  logger.info('oauth_provider_linked', { userId: req.user!.id, provider });
  return res.json(ok(null, `${provider} linked successfully`));
});

// ─── DELETE /api/auth/oauth/unlink/:provider ──────────────────────────────────
router.delete('/oauth/unlink/:provider', authenticateJWT, (req: AuthenticatedRequest, res) => {
  const provider = req.params.provider as OAuthProvider;
  if (!['google', 'apple', 'facebook'].includes(provider)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Unknown provider');
  }

  const user = store.users.get(req.user!.id) as unknown as OAuthStoredUser;
  const identities = user?.oauthIdentities ?? [];
  const hasPassword = !!(store.users.get(req.user!.id) as { passwordHash?: string })?.passwordHash;

  // Must have another login method before unlinking
  if (!hasPassword && identities.filter((id) => id.provider !== provider).length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Cannot unlink the only login method');
  }

  patchUser(req.user!.id, {
    oauthIdentities: identities.filter((id) => id.provider !== provider),
  });

  logger.info('oauth_provider_unlinked', { userId: req.user!.id, provider });
  return res.json(ok(null, `${provider} unlinked`));
});

export default router;
