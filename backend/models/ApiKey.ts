/**
 * API key domain types for third-party integrations.
 */

/** Permission scopes assignable to an API key. */
export const API_KEY_SCOPES = [
  'pets:read',
  'pets:write',
  'medical-records:read',
  'medical-records:write',
  'appointments:read',
  'appointments:write',
  'analytics:read',
  'webhooks:write',
  'search:read',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export type ApiKeyStatus = 'active' | 'rotating' | 'revoked';

/** Default per-key request budget per minute when none is configured at creation. */
export const DEFAULT_API_KEY_RATE_LIMIT = 100;

export interface ApiKey {
  id: string;
  name: string;
  /** Public prefix for lookup (e.g. pk_live_Ab12Cd34). */
  keyPrefix: string;
  /** bcrypt hash of the full secret — never exposed via API. */
  keyHash: string;
  scopes: ApiKeyScope[];
  status: ApiKeyStatus;
  createdBy: string;
  expiresAt?: string;
  /** Previous key id when this key was created via rotation. */
  rotatedFromId?: string;
  /** During rotation, old key remains valid until this timestamp. */
  rotationOverlapEndsAt?: string;
  lastUsedAt?: string;
  /** Per-key request budget per minute (Redis-enforced, separate from IP limits). */
  rateLimitPerMinute?: number;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

/** Safe view returned from list/detail endpoints (no hash). */
export interface ApiKeyPublic {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  status: ApiKeyStatus;
  createdBy: string;
  expiresAt?: string;
  rotatedFromId?: string;
  rotationOverlapEndsAt?: string;
  lastUsedAt?: string;
  rateLimitPerMinute?: number;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export interface ApiKeyUsageRecord {
  id: string;
  apiKeyId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  timestamp: string;
}

export interface ApiKeyUsageSummary {
  apiKeyId: string;
  endpoint: string;
  method: string;
  count: number;
  lastCalledAt: string;
}

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  expiresAt?: string;
  /** Optional per-key request budget per minute; defaults to DEFAULT_API_KEY_RATE_LIMIT. */
  rateLimitPerMinute?: number;
}

export interface ApiKeyCreateResult {
  key: ApiKeyPublic;
  /** Plaintext secret — shown only once at creation or rotation. */
  secret: string;
}
