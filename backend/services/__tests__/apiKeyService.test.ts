import type { ApiKeyScope } from '../../models/ApiKey';
import { store } from '../../server/store';
import apiKeyService, {
  DEFAULT_ROTATION_OVERLAP_MS,
  generateKeyMaterial,
  hashKey,
  verifyKey,
} from '../apiKeyService';

describe('apiKeyService', () => {
  beforeAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    apiKeyService.resetApiKeyStore();
  });

  describe('key generation', () => {
    it('generates cryptographically formatted keys with pk_live prefix', () => {
      const { secret, prefix } = generateKeyMaterial();
      expect(secret).toMatch(/^pk_live_[A-Za-z0-9_-]+$/);
      expect(prefix).toBe(secret.slice(0, 16));
    });

    it('stores bcrypt hash, never plaintext', async () => {
      const { secret } = generateKeyMaterial();
      const hash = await hashKey(secret);
      expect(hash).not.toBe(secret);
      expect(hash.startsWith('$2')).toBe(true);
      expect(await verifyKey(secret, hash)).toBe(true);
      expect(await verifyKey('wrong-key', hash)).toBe(false);
    });
  });

  describe('create and validate', () => {
    it('creates a key with scopes and validates it', async () => {
      const scopes: ApiKeyScope[] = ['pets:read', 'search:read'];
      const { secret, key } = await apiKeyService.createApiKey(
        { name: 'Test Partner', scopes },
        'admin-1',
      );

      expect(key.name).toBe('Test Partner');
      expect(key.scopes).toEqual(scopes);
      expect(key.keyPrefix).toBe(secret.slice(0, 16));
      expect(secret).toMatch(/^pk_live_/);

      const validated = await apiKeyService.validateApiKey(secret);
      expect(validated?.id).toBe(key.id);
    });

    it('rejects invalid scopes on create', async () => {
      await expect(
        apiKeyService.createApiKey(
          { name: 'Bad', scopes: ['invalid:scope'] as ApiKeyScope[] },
          'admin-1',
        ),
      ).rejects.toThrow('INVALID_SCOPES');
    });

    it('rejects unknown or revoked keys', async () => {
      expect(await apiKeyService.validateApiKey('pk_live_notavalidkeyxx')).toBeNull();

      const { secret, key } = await apiKeyService.createApiKey(
        { name: 'Revoke me', scopes: ['pets:read'] },
        'admin-1',
      );
      apiKeyService.revokeApiKey(key.id);
      expect(await apiKeyService.validateApiKey(secret)).toBeNull();
    });
  });

  describe('rotation', () => {
    it('rotates with overlap — old key works until overlap ends', async () => {
      const created = await apiKeyService.createApiKey(
        { name: 'Rotate test', scopes: ['pets:read'] },
        'admin-1',
      );

      const rotated = await apiKeyService.rotateApiKey(created.key.id, 60_000);
      expect(rotated.secret).not.toBe(created.secret);
      expect(rotated.key.rotatedFromId).toBe(created.key.id);

      expect(await apiKeyService.validateApiKey(created.secret)).not.toBeNull();
      expect(await apiKeyService.validateApiKey(rotated.secret)).not.toBeNull();

      const oldRecord = [...store.apiKeys.values()].find((k) => k.id === created.key.id)!;
      oldRecord.rotationOverlapEndsAt = new Date(Date.now() - 1000).toISOString();
      apiKeyService.processRotationExpiry();

      expect(await apiKeyService.validateApiKey(created.secret)).toBeNull();
      expect(await apiKeyService.validateApiKey(rotated.secret)).not.toBeNull();
    });

    it('uses default overlap period constant', () => {
      expect(DEFAULT_ROTATION_OVERLAP_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('usage and rate limiting', () => {
    it('records usage per endpoint', async () => {
      const { key } = await apiKeyService.createApiKey(
        { name: 'Usage', scopes: ['pets:read'] },
        'admin-1',
      );
      apiKeyService.recordUsage(key.id, '/api/integrations/pets', 'GET', 200);
      apiKeyService.recordUsage(key.id, '/api/integrations/pets', 'GET', 200);

      const summary = apiKeyService.getUsageSummary(key.id);
      expect(summary).toHaveLength(1);
      expect(summary[0].count).toBe(2);
      expect(summary[0].endpoint).toBe('/api/integrations/pets');
    });

    it('enforces per-endpoint rate limits', async () => {
      const { key } = await apiKeyService.createApiKey(
        { name: 'Rate', scopes: ['pets:read'] },
        'admin-1',
      );
      const endpoint = '/api/integrations/pets';
      let allowed = 0;
      for (let i = 0; i < 105; i++) {
        if (apiKeyService.checkRateLimit(key.id, endpoint)) allowed += 1;
      }
      expect(allowed).toBe(100);
    });
  });

  describe('scopes', () => {
    it('checks required scopes', async () => {
      const { key: pub } = await apiKeyService.createApiKey(
        { name: 'Scoped', scopes: ['pets:read'] },
        'admin-1',
      );
      const full = [...store.apiKeys.values()].find((k) => k.id === pub.id)!;
      expect(apiKeyService.hasScope(full, 'pets:read')).toBe(true);
      expect(apiKeyService.hasScope(full, 'pets:write')).toBe(false);
      expect(apiKeyService.hasScope(full, ['pets:read', 'search:read'])).toBe(false);
    });
  });

  describe('expiry enforcement', () => {
    it('rejects an expired key with api_key_expired error', async () => {
      const { secret, key } = await apiKeyService.createApiKey(
        {
          name: 'Expiry test',
          scopes: ['pets:read'],
          expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
        },
        'admin-1',
      );

      await expect(apiKeyService.validateApiKey(secret)).rejects.toThrow('api_key_expired');
      await expect(apiKeyService.validateApiKey(secret)).rejects.toMatchObject({
        code: 'API_KEY_EXPIRED',
      });
    });

    it('accepts a key that has not yet expired', async () => {
      const { secret } = await apiKeyService.createApiKey(
        {
          name: 'Future expiry',
          scopes: ['pets:read'],
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        'admin-1',
      );
      const validated = await apiKeyService.validateApiKey(secret);
      expect(validated).not.toBeNull();
    });

    it('key with no expiresAt never expires via this path', async () => {
      const { secret } = await apiKeyService.createApiKey(
        { name: 'No expiry', scopes: ['pets:read'] },
        'admin-1',
      );
      const validated = await apiKeyService.validateApiKey(secret);
      expect(validated).not.toBeNull();
    });
  });

  describe('cleanupExpiredApiKeys background job', () => {
    it('deletes keys expired more than 30 days ago', async () => {
      const { key: old } = await apiKeyService.createApiKey(
        {
          name: 'Old expired',
          scopes: ['pets:read'],
          expiresAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
        },
        'admin-1',
      );
      const { key: recent } = await apiKeyService.createApiKey(
        {
          name: 'Recently expired',
          scopes: ['pets:read'],
          expiresAt: new Date(Date.now() - 1000).toISOString(), // expired but < 30 days
        },
        'admin-1',
      );
      const { key: active } = await apiKeyService.createApiKey(
        { name: 'Active', scopes: ['pets:read'] },
        'admin-1',
      );

      const result = apiKeyService.cleanupExpiredApiKeys();
      expect(result.deleted).toBe(1);
      expect(store.apiKeys.has(old.id)).toBe(false);
      expect(store.apiKeys.has(recent.id)).toBe(true);
      expect(store.apiKeys.has(active.id)).toBe(true);
    });

    it('returns 0 when no keys are eligible for deletion', async () => {
      await apiKeyService.createApiKey({ name: 'Active', scopes: ['pets:read'] }, 'admin-1');
      const result = apiKeyService.cleanupExpiredApiKeys();
      expect(result.deleted).toBe(0);
    });
  });
});
