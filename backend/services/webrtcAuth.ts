/**
 * WebRTC signaling authentication — backend
 *
 * Hardens telemedicine signaling against guessable / replayed `join_room`
 * messages (issue #970). A caller must present a short-lived, cryptographically
 * signed token that is scoped to a single consultation, user, role and
 * signaling session. Tokens are single-use: a consumed nonce cannot be
 * replayed, and the connection origin is checked against an allow-list.
 *
 * The token is deliberately opaque and carries no PHI — only opaque ids, an
 * issue/expiry timestamp and a random nonce.
 *
 * Environment variables:
 *   SIGNALING_TOKEN_SECRET  — HMAC secret for signing signaling tokens (required in prod)
 *   SIGNALING_TOKEN_TTL_SEC — Token lifetime in seconds (default: 120)
 *   SIGNALING_ALLOWED_ORIGINS — Comma-separated origin allow-list (default: allow all)
 */

import crypto from 'crypto';

const TOKEN_VERSION = 'v1';

const DEFAULT_TTL_SECONDS = Number(process.env.SIGNALING_TOKEN_TTL_SEC) || 120;

const SECRET =
  process.env.SIGNALING_TOKEN_SECRET ??
  // Fallback keeps local/dev + tests deterministic; production must set the env var.
  'dev-only-insecure-signaling-secret';

const ALLOWED_ORIGINS = (process.env.SIGNALING_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface SignalingTokenClaims {
  /** Consultation the token grants access to. */
  consultationId: string;
  /** Opaque id of the authenticated user. */
  userId: string;
  /** Role the user joins as (e.g. "owner" / "vet"). */
  role: string;
  /** Signaling session id — binds the token to one negotiated session. */
  sessionId: string;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
  /** Random single-use nonce (hex). */
  nonce: string;
}

export interface IssueTokenInput {
  consultationId: string;
  userId: string;
  role: string;
  sessionId: string;
  ttlSeconds?: number;
  /** Injectable clock for tests (epoch ms). */
  now?: number;
}

export interface VerifyTokenInput {
  /** The consultation the socket is attempting to join. */
  consultationId: string;
  /** The user the socket claims to be. */
  userId: string;
  /** The signaling session id negotiated for this socket. */
  sessionId: string;
  /** Origin header of the socket handshake, if any. */
  origin?: string | null;
  /** Injectable clock for tests (epoch ms). */
  now?: number;
}

export type VerifyResult =
  | { ok: true; claims: SignalingTokenClaims }
  | { ok: false; code: SignalingAuthErrorCode; message: string };

export type SignalingAuthErrorCode =
  | 'MALFORMED'
  | 'BAD_SIGNATURE'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'SCOPE_MISMATCH'
  | 'ORIGIN_NOT_ALLOWED'
  | 'REPLAYED';

// ─────────────────────────────────────────────────────────────────────────────
// REPLAY PROTECTION  (in-memory; swap for Redis in a multi-node deployment)
// ─────────────────────────────────────────────────────────────────────────────

const consumedNonces = new Map<string, number>(); // nonce -> expiry epoch ms

function sweepExpiredNonces(nowMs: number): void {
  for (const [nonce, expiresAt] of consumedNonces) {
    if (expiresAt <= nowMs) consumedNonces.delete(nonce);
  }
}

/** Test hook — clears the replay cache. */
export function __resetReplayCache(): void {
  consumedNonces.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNING
// ─────────────────────────────────────────────────────────────────────────────

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Issues a short-lived, scoped signaling token. Call this from the authenticated
 * REST layer once a user is allowed into a consultation, then hand the token to
 * the client to present on `join_room`.
 */
export function issueSignalingToken(input: IssueTokenInput): {
  token: string;
  claims: SignalingTokenClaims;
} {
  const nowMs = input.now ?? Date.now();
  const iat = Math.floor(nowMs / 1000);
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  const claims: SignalingTokenClaims = {
    consultationId: input.consultationId,
    userId: input.userId,
    role: input.role,
    sessionId: input.sessionId,
    iat,
    exp: iat + ttl,
    nonce: crypto.randomBytes(16).toString('hex'),
  };

  const body = b64url(JSON.stringify(claims));
  const header = b64url(TOKEN_VERSION);
  const signature = sign(`${header}.${body}`);

  return { token: `${header}.${body}.${signature}`, claims };
}

/**
 * Verifies a signaling token for a `join_room` attempt. Enforces signature,
 * expiry, scope (consultation + user + session), origin allow-list and
 * single-use replay protection.
 */
export function verifySignalingToken(token: string, expected: VerifyTokenInput): VerifyResult {
  const nowMs = expected.now ?? Date.now();

  if (typeof token !== 'string' || token.length > 4096) {
    return { ok: false, code: 'MALFORMED', message: 'Missing or oversized token' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, code: 'MALFORMED', message: 'Token must have 3 segments' };
  }
  const [header, body, signature] = parts;

  if (!safeEqual(signature, sign(`${header}.${body}`))) {
    return { ok: false, code: 'BAD_SIGNATURE', message: 'Signature mismatch' };
  }

  let claims: SignalingTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignalingTokenClaims;
  } catch {
    return { ok: false, code: 'MALFORMED', message: 'Token payload is not valid JSON' };
  }

  if (
    !claims ||
    typeof claims.consultationId !== 'string' ||
    typeof claims.userId !== 'string' ||
    typeof claims.sessionId !== 'string' ||
    typeof claims.nonce !== 'string' ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number'
  ) {
    return { ok: false, code: 'MALFORMED', message: 'Token payload is missing claims' };
  }

  const nowSec = Math.floor(nowMs / 1000);
  if (nowSec >= claims.exp) {
    return { ok: false, code: 'EXPIRED', message: 'Token has expired' };
  }
  // Allow 30s of clock skew for freshly-issued tokens.
  if (nowSec + 30 < claims.iat) {
    return { ok: false, code: 'NOT_YET_VALID', message: 'Token issued in the future' };
  }

  if (
    claims.consultationId !== expected.consultationId ||
    claims.userId !== expected.userId ||
    claims.sessionId !== expected.sessionId
  ) {
    return { ok: false, code: 'SCOPE_MISMATCH', message: 'Token scope does not match request' };
  }

  if (!isOriginAllowed(expected.origin)) {
    return { ok: false, code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not permitted' };
  }

  // Replay protection — a nonce may be consumed exactly once, until it expires.
  sweepExpiredNonces(nowMs);
  if (consumedNonces.has(claims.nonce)) {
    return { ok: false, code: 'REPLAYED', message: 'Token has already been used' };
  }
  consumedNonces.set(claims.nonce, claims.exp * 1000);

  return { ok: true, claims };
}

/**
 * Checks an origin against the configured allow-list. An empty allow-list
 * (default) permits any origin so existing dev setups keep working; production
 * deployments should set SIGNALING_ALLOWED_ORIGINS.
 */
export function isOriginAllowed(origin?: string | null): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true;
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}
