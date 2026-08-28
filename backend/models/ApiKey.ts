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
}

export interface ApiKeyCreateResult {
  key: ApiKeyPublic;
  /** Plaintext secret — shown only once at creation or rotation. */
  secret: string;
}
