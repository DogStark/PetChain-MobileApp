/**
 * API key lifecycle: generation, bcrypt storage, rotation overlap, usage analytics.
 */

import { createHash, randomBytes } from 'crypto';

import bcrypt from 'bcryptjs';

import type {
  ApiKey,
  ApiKeyCreateResult,
  ApiKeyPublic,
  ApiKeyScope,
  ApiKeyUsageRecord,
  ApiKeyUsageSummary,
  CreateApiKeyInput,
} from '../models/ApiKey';
import { API_KEY_SCOPES } from '../models/ApiKey';
import { store, newId } from '../server/store';

const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 10;
const KEY_RANDOM_BYTES = 32;
const PREFIX_SEGMENT = 'pk_live';
/** Default overlap window while old and new keys both work during rotation. */
export const DEFAULT_ROTATION_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000;

/** Per-key per-endpoint rate limit: max requests per window. */
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();

function toPublic(key: ApiKey): ApiKeyPublic {
  const { keyHash: _hash, ...rest } = key;
  return rest;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Cryptographically secure API key material. */
export function generateKeyMaterial(): { secret: string; prefix: string } {
  const randomPart = randomBytes(KEY_RANDOM_BYTES).toString('base64url');
  const secret = `${PREFIX_SEGMENT}_${randomPart}`;
  const prefix = secret.slice(0, PREFIX_SEGMENT.length + 9);
  return { secret, prefix };
}

export async function hashKey(secret: string): Promise<string> {
  return bcrypt.hashSync(secret, BCRYPT_ROUNDS);
}

export async function verifyKey(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compareSync(secret, hash);
}

function isScopeValid(scopes: string[]): scopes is ApiKeyScope[] {
  return (
    scopes.length > 0 && scopes.every((s) => (API_KEY_SCOPES as readonly string[]).includes(s))
  );
}

function isKeyUsable(key: ApiKey, at = Date.now()): boolean {
  if (key.status === 'revoked') return false;
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= at) return false;
  if (key.status === 'rotating' && key.rotationOverlapEndsAt) {
    return new Date(key.rotationOverlapEndsAt).getTime() > at;
  }
  return key.status === 'active' || key.status === 'rotating';
}

/** Expire rotating keys whose overlap window has ended. */
export function processRotationExpiry(): void {
  const now = Date.now();
  for (const key of store.apiKeys.values()) {
    if (
      key.status === 'rotating' &&
      key.rotationOverlapEndsAt &&
      new Date(key.rotationOverlapEndsAt).getTime() <= now
    ) {
      key.status = 'revoked';
      key.revokedAt = nowIso();
      key.updatedAt = nowIso();
    }
  }
}

export async function createApiKey(
  input: CreateApiKeyInput,
  createdBy: string,
): Promise<ApiKeyCreateResult> {
  if (!isScopeValid(input.scopes)) {
    throw new Error('INVALID_SCOPES');
  }

  const { secret, prefix } = generateKeyMaterial();
  const keyHash = await hashKey(secret);
  const t = nowIso();
  const id = newId();

  const record: ApiKey = {
    id,
    name: input.name.trim(),
    keyPrefix: prefix,
    keyHash,
    scopes: input.scopes,
    status: 'active',
    createdBy,
    expiresAt: input.expiresAt,
    createdAt: t,
    updatedAt: t,
  };

  store.apiKeys.set(id, record);

  return { key: toPublic(record), secret };
}

export function listApiKeys(): ApiKeyPublic[] {
  processRotationExpiry();
  return [...store.apiKeys.values()]
    .map(toPublic)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getApiKey(id: string): ApiKeyPublic | undefined {
  const key = store.apiKeys.get(id);
  return key ? toPublic(key) : undefined;
}

export async function validateApiKey(secret: string): Promise<ApiKey | null> {
  processRotationExpiry();

  if (!secret.startsWith(`${PREFIX_SEGMENT}_`)) {
    return null;
  }

  const prefix = secret.slice(0, PREFIX_SEGMENT.length + 9);
  const candidates = [...store.apiKeys.values()].filter((k) => k.keyPrefix === prefix);

  for (const candidate of candidates) {
    if (await verifyKey(secret, candidate.keyHash)) {
      if (!isKeyUsable(candidate)) {
        // Key matches but is expired or revoked — surface expiry specifically
        if (
          candidate.status !== 'revoked' &&
          candidate.expiresAt &&
          new Date(candidate.expiresAt).getTime() <= Date.now()
        ) {
          const err = new Error('api_key_expired') as Error & { code: string };
          err.code = 'API_KEY_EXPIRED';
          throw err;
        }
        return null;
      }
      candidate.lastUsedAt = nowIso();
      candidate.updatedAt = nowIso();
      return candidate;
    }
  }

  return null;
}

/**
 * Background job: permanently delete API keys that expired more than 30 days ago.
 * Safe to call on a daily cron schedule.
 */
export function cleanupExpiredApiKeys(): { deleted: number } {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const [id, key] of store.apiKeys.entries()) {
    if (key.expiresAt && new Date(key.expiresAt).getTime() <= cutoff) {
      store.apiKeys.delete(id);
      deleted += 1;
    }
  }
  return { deleted };
}

export function hasScope(key: ApiKey, required: ApiKeyScope | ApiKeyScope[]): boolean {
  const needed = Array.isArray(required) ? required : [required];
  return needed.every((s) => key.scopes.includes(s));
}

/**
 * Rotate an API key: issue a new secret, mark the old key as rotating with overlap.
 */
export async function rotateApiKey(
  id: string,
  overlapMs = DEFAULT_ROTATION_OVERLAP_MS,
): Promise<ApiKeyCreateResult> {
  const existing = store.apiKeys.get(id);
  if (!existing) {
    throw new Error('NOT_FOUND');
  }
  if (existing.status === 'revoked') {
    throw new Error('ALREADY_REVOKED');
  }

  const overlapEnds = new Date(Date.now() + overlapMs).toISOString();
  existing.status = 'rotating';
  existing.rotationOverlapEndsAt = overlapEnds;
  existing.updatedAt = nowIso();

  const { secret, prefix } = generateKeyMaterial();
  const keyHash = await hashKey(secret);
  const t = nowIso();
  const newKeyId = newId();

  const record: ApiKey = {
    id: newKeyId,
    name: existing.name,
    keyPrefix: prefix,
    keyHash,
    scopes: [...existing.scopes],
    status: 'active',
    createdBy: existing.createdBy,
    expiresAt: existing.expiresAt,
    rotatedFromId: existing.id,
    createdAt: t,
    updatedAt: t,
  };

  store.apiKeys.set(newKeyId, record);

  return { key: toPublic(record), secret };
}

export function revokeApiKey(id: string): ApiKeyPublic | null {
  const key = store.apiKeys.get(id);
  if (!key) return null;
  if (key.status === 'revoked') return toPublic(key);

  key.status = 'revoked';
  key.revokedAt = nowIso();
  key.updatedAt = nowIso();
  return toPublic(key);
}

export function recordUsage(
  apiKeyId: string,
  endpoint: string,
  method: string,
  statusCode: number,
): void {
  const record: ApiKeyUsageRecord = {
    id: newId(),
    apiKeyId,
    endpoint,
    method: method.toUpperCase(),
    statusCode,
    timestamp: nowIso(),
  };
  store.apiKeyUsage.push(record);
}

export function getUsageSummary(apiKeyId?: string): ApiKeyUsageSummary[] {
  const records = apiKeyId
    ? store.apiKeyUsage.filter((r) => r.apiKeyId === apiKeyId)
    : store.apiKeyUsage;

  const map = new Map<string, ApiKeyUsageSummary>();

  for (const r of records) {
    const bucketKey = `${r.apiKeyId}|${r.method}|${r.endpoint}`;
    const existing = map.get(bucketKey);
    if (!existing) {
      map.set(bucketKey, {
        apiKeyId: r.apiKeyId,
        endpoint: r.endpoint,
        method: r.method,
        count: 1,
        lastCalledAt: r.timestamp,
      });
    } else {
      existing.count += 1;
      if (r.timestamp > existing.lastCalledAt) {
        existing.lastCalledAt = r.timestamp;
      }
    }
  }

  return [...map.values()].sort((a, b) => b.lastCalledAt.localeCompare(a.lastCalledAt));
}

/** Sliding-window rate limit per apiKeyId + endpoint. */
export function checkRateLimit(apiKeyId: string, endpoint: string): boolean {
  const bucketKey = createHash('sha256').update(`${apiKeyId}:${endpoint}`).digest('hex');
  const now = Date.now();
  let bucket = rateLimitBuckets.get(bucketKey);

  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    rateLimitBuckets.set(bucketKey, bucket);
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    return false;
  }

  bucket.count += 1;
  return true;
}

/** Reset in-memory state (tests). */
export function resetApiKeyStore(): void {
  store.apiKeys.clear();
  store.apiKeyUsage.length = 0;
  rateLimitBuckets.clear();
}

export function getAvailableScopes(): readonly ApiKeyScope[] {
  return API_KEY_SCOPES;
}

export default {
  createApiKey,
  listApiKeys,
  getApiKey,
  validateApiKey,
  rotateApiKey,
  revokeApiKey,
  recordUsage,
  getUsageSummary,
  checkRateLimit,
  hasScope,
  generateKeyMaterial,
  hashKey,
  verifyKey,
  processRotationExpiry,
  cleanupExpiredApiKeys,
  resetApiKeyStore,
  getAvailableScopes,
  DEFAULT_ROTATION_OVERLAP_MS,
};
