/**
 * diagnosticExport.test.ts — #1035 privacy-safe diagnostic export
 *
 * Covers:
 *  - explicit confirmation + recent auth gates
 *  - structural redaction of secrets, IDs, health fields, locations
 *  - bundle expiry + delete after share/cancel
 *  - representative crash, sync, wallet, and SOS logs
 */

jest.mock('expo-file-system', () => ({
  cacheDirectory: '/mock/cache/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

import * as FileSystem from 'expo-file-system';
import {
  BundleExpiredError,
  ConfirmationRequiredError,
  DEFAULT_BUNDLE_TTL_MS,
  RECENT_AUTH_MAX_AGE_MS,
  REDACTED,
  RecentAuthRequiredError,
  assertBundleUsable,
  createDiagnosticBundle,
  deleteDiagnosticBundle,
  exportDiagnosticsForSupport,
  isBundleExpired,
  isSensitiveKey,
  redactDiagnosticPayload,
  writeDiagnosticBundle,
  type DiagnosticLogEntry,
} from '../diagnosticExport';

const T0 = Date.parse('2026-09-24T12:00:00Z');

const freshConfirmation = { confirmed: true as const, confirmedAt: T0 - 1_000 };
const freshAuth = { method: 'biometric' as const, authenticatedAt: T0 - 500 };

const crashLog: DiagnosticLogEntry = {
  kind: 'crash',
  timestamp: '2026-09-24T11:59:00Z',
  message: 'Unhandled exception in PetDetailScreen',
  data: {
    stack: 'Error: boom\n  at PetDetailScreen',
    petId: 'pet_a1b2c3d4e5f6',
    healthNote: 'Vomiting after meal',
    authToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb',
  },
};

const syncLog: DiagnosticLogEntry = {
  kind: 'sync',
  timestamp: '2026-09-24T11:58:00Z',
  message: 'Sync failed for medical records',
  data: {
    recordCount: 12,
    endpoint: 'https://user:secretpass@api.petchain.app/v1/sync',
    medicalHistory: ['allergy:penicillin'],
    latitude: 37.7749,
    longitude: -122.4194,
  },
};

const walletLog: DiagnosticLogEntry = {
  kind: 'wallet',
  timestamp: '2026-09-24T11:57:00Z',
  message: 'Stellar payment submit failed',
  data: {
    walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ',
    publicKey: 'pk_live_abc123',
    secret: 'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    status: 'failed',
  },
};

const sosLog: DiagnosticLogEntry = {
  kind: 'sos',
  timestamp: '2026-09-24T11:56:00Z',
  message: 'SOS triggered near clinic',
  data: {
    location: { city: 'SF', lat: 37.77 },
    pet_id: 'pet-deadbeefcafebabe',
    contactPhone: '+1-555-0100',
    authorization: 'Bearer sk_live_supersecret',
  },
};

describe('diagnosticExport (issue #1035)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('gates: confirmation + recent auth', () => {
    it('refuses export without explicit confirmation', () => {
      expect(() =>
        createDiagnosticBundle({
          logs: [crashLog],
          confirmation: undefined as never,
          auth: freshAuth,
          now: T0,
        }),
      ).toThrow(ConfirmationRequiredError);
    });

    it('refuses export when confirmation is stale', () => {
      const stale = {
        confirmed: true as const,
        confirmedAt: T0 - RECENT_AUTH_MAX_AGE_MS - 1,
      };
      expect(() =>
        createDiagnosticBundle({
          logs: [crashLog],
          confirmation: stale,
          auth: freshAuth,
          now: T0,
        }),
      ).toThrow(ConfirmationRequiredError);
    });

    it('refuses export without recent authentication', () => {
      expect(() =>
        createDiagnosticBundle({
          logs: [crashLog],
          confirmation: freshConfirmation,
          auth: undefined as never,
          now: T0,
        }),
      ).toThrow(RecentAuthRequiredError);
    });

    it('refuses export when authentication is stale', () => {
      const staleAuth = {
        method: 'passcode' as const,
        authenticatedAt: T0 - RECENT_AUTH_MAX_AGE_MS - 1,
      };
      expect(() =>
        createDiagnosticBundle({
          logs: [crashLog],
          confirmation: freshConfirmation,
          auth: staleAuth,
          now: T0,
        }),
      ).toThrow(RecentAuthRequiredError);
    });

    it('creates a bundle when confirmation and auth are fresh', () => {
      const bundle = createDiagnosticBundle({
        logs: [crashLog, syncLog, walletLog, sosLog],
        confirmation: freshConfirmation,
        auth: freshAuth,
        now: T0,
        ttlMs: 60_000,
        generateId: () => 'bundle-test-1',
        app: { version: '1.2.3', platform: 'ios' },
      });
      expect(bundle.meta).toMatchObject({
        bundleId: 'bundle-test-1',
        createdAt: T0,
        expiresAt: T0 + 60_000,
        logCount: 4,
        redacted: true,
      });
      expect(bundle.app.version).toBe('1.2.3');
    });
  });

  describe('structural redaction', () => {
    it('flags secrets, IDs, health, and location keys as sensitive', () => {
      expect(isSensitiveKey('authToken')).toBe(true);
      expect(isSensitiveKey('petId')).toBe(true);
      expect(isSensitiveKey('healthNote')).toBe(true);
      expect(isSensitiveKey('latitude')).toBe(true);
      expect(isSensitiveKey('recordCount')).toBe(false);
      expect(isSensitiveKey('status')).toBe(false);
    });

    it('redacts nested secrets, pet IDs, health fields, and locations', () => {
      const redacted = redactDiagnosticPayload({
        status: 'ok',
        nested: {
          apiKey: 'sk_live_abc',
          petId: 'pet_12345678abcd',
          healthStatus: 'critical',
          coordinates: { lat: 1, lng: 2 },
          message: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb failed',
        },
      }) as Record<string, unknown>;

      expect(redacted.status).toBe('ok');
      const nested = redacted.nested as Record<string, unknown>;
      expect(nested.apiKey).toBe(REDACTED);
      expect(nested.petId).toBe(REDACTED);
      expect(nested.healthStatus).toBe(REDACTED);
      expect(nested.coordinates).toBe(REDACTED);
      expect(nested.message).toContain(REDACTED);
      expect(JSON.stringify(nested)).not.toContain('sk_live_abc');
      expect(JSON.stringify(nested)).not.toContain('pet_12345678abcd');
    });
  });

  describe('representative log kinds', () => {
    it('redacts crash, sync, wallet, and SOS logs in the exported bundle', () => {
      const bundle = createDiagnosticBundle({
        logs: [crashLog, syncLog, walletLog, sosLog],
        confirmation: freshConfirmation,
        auth: freshAuth,
        now: T0,
        generateId: () => 'bundle-logs',
      });

      const byKind = Object.fromEntries(bundle.logs.map((l) => [l.kind, l]));
      expect(byKind.crash.data?.petId).toBe(REDACTED);
      expect(byKind.crash.data?.healthNote).toBe(REDACTED);
      expect(byKind.crash.data?.authToken).toBe(REDACTED);
      expect(byKind.crash.data?.stack).toContain('PetDetailScreen');

      expect(byKind.sync.data?.recordCount).toBe(12);
      expect(byKind.sync.data?.medicalHistory).toBe(REDACTED);
      expect(byKind.sync.data?.latitude).toBe(REDACTED);
      expect(byKind.sync.data?.longitude).toBe(REDACTED);
      expect(String(byKind.sync.data?.endpoint)).toBe(REDACTED);

      expect(byKind.wallet.data?.walletAddress).toBe(REDACTED);
      expect(byKind.wallet.data?.publicKey).toBe(REDACTED);
      expect(byKind.wallet.data?.secret).toBe(REDACTED);
      expect(byKind.wallet.data?.status).toBe('failed');

      expect(byKind.sos.data?.location).toBe(REDACTED);
      expect(byKind.sos.data?.pet_id).toBe(REDACTED);
      expect(byKind.sos.data?.contactPhone).toBe(REDACTED);
      expect(byKind.sos.data?.authorization).toBe(REDACTED);

      const serialized = JSON.stringify(bundle);
      expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(serialized).not.toContain('secretpass');
      expect(serialized).not.toContain('SXXXXXXXX');
      expect(serialized).not.toContain('+1-555-0100');
      expect(serialized).not.toContain('Vomiting after meal');
    });
  });

  describe('expiry and cleanup', () => {
    it('expires the bundle after its TTL', () => {
      const bundle = createDiagnosticBundle({
        logs: [crashLog],
        confirmation: freshConfirmation,
        auth: freshAuth,
        now: T0,
        ttlMs: 1_000,
        generateId: () => 'expiring',
      });
      expect(isBundleExpired(bundle, T0 + 500)).toBe(false);
      expect(isBundleExpired(bundle, T0 + 1_000)).toBe(true);
      expect(() => assertBundleUsable(bundle, T0 + 2_000)).toThrow(BundleExpiredError);
      expect(bundle.meta.expiresAt).toBe(T0 + 1_000);
      expect(DEFAULT_BUNDLE_TTL_MS).toBeGreaterThan(0);
    });

    it('writes the bundle then deletes it after share', async () => {
      const share = jest.fn().mockResolvedValue(true);
      const result = await exportDiagnosticsForSupport({
        logs: [crashLog, syncLog, walletLog, sosLog],
        confirmation: freshConfirmation,
        auth: freshAuth,
        now: T0,
        share,
      });

      expect(result.shared).toBe(true);
      expect(FileSystem.writeAsStringAsync).toHaveBeenCalled();
      expect(share).toHaveBeenCalled();
      expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
        expect.stringContaining('petchain-diagnostics-'),
        { idempotent: true },
      );
    });

    it('deletes the bundle after cancellation', async () => {
      const share = jest.fn().mockResolvedValue(false);
      const result = await exportDiagnosticsForSupport({
        logs: [syncLog],
        confirmation: freshConfirmation,
        auth: freshAuth,
        now: T0,
        share,
      });
      expect(result.shared).toBe(false);
      expect(FileSystem.deleteAsync).toHaveBeenCalled();
    });

    it('deleteDiagnosticBundle is idempotent', async () => {
      (FileSystem.deleteAsync as jest.Mock).mockRejectedValueOnce(new Error('missing'));
      await expect(deleteDiagnosticBundle('missing-id')).resolves.toBeUndefined();
    });

    it('writeDiagnosticBundle refuses expired bundles', async () => {
      const bundle = createDiagnosticBundle({
        logs: [walletLog],
        confirmation: freshConfirmation,
        auth: freshAuth,
        now: T0,
        ttlMs: 1,
        generateId: () => 'too-late',
      });
      // Force expiry
      bundle.meta.expiresAt = T0 - 1;
      await expect(writeDiagnosticBundle(bundle)).rejects.toThrow(BundleExpiredError);
    });
  });
});
