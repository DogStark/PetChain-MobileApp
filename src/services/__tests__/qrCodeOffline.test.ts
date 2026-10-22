import * as SQLite from 'expo-sqlite';

import {
  generatePetQRCode,
  getOfflineQRCodeInfo,
  parseQRCodeData,
  revokeQRCode,
  scanQRCode,
} from '../qrCodeService';
import {
  buildPetDeepLink,
  cacheQRPayload,
  encodePayload,
  markQRRevoked,
} from '../../utils/qrUtils';

// Local Pet shape (no dependency on the service's Pet model for isolation).
type Species = 'dog' | 'cat' | 'bird';
type Pet = {
  id: string;
  name: string;
  species: Species;
  breed: string;
  microchipId: string;
  ownerId: string;
  qrCode: string;
  createdAt: string;
  updatedAt: string;
};

const mockPet: Pet = {
  id: 'pet-123',
  name: 'Buddy',
  species: 'dog',
  breed: 'Labrador',
  microchipId: 'MIC-1',
  ownerId: 'user-1',
  qrCode: 'qr',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

// Reset the in-memory expo-sqlite mock so tests never leak cache/token state.
const resetStorage = () =>
  (SQLite as unknown as { __resetMockStorage?: () => void }).__resetMockStorage?.();

describe('qrCodeService offline verification (Issue #937)', () => {
  beforeEach(() => {
    resetStorage();
  });

  describe('getOfflineQRCodeInfo', () => {
    it('reports a freshly generated cached QR as verified', async () => {
      const qr = await generatePetQRCode(mockPet);
      const info = await getOfflineQRCodeInfo(mockPet.id);

      expect(info.status).toBe('verified');
      expect(info.petId).toBe(mockPet.id);
      expect(info.payload).toBe(qr);
    });

    it('reports a revoked cached QR as revoked', async () => {
      const qr = await generatePetQRCode(mockPet);
      const data = parseQRCodeData(qr);
      const token = (data as { token?: string }).token;
      expect(token).toBeDefined();

      await revokeQRCode(token as string);

      const info = await getOfflineQRCodeInfo(mockPet.id);
      expect(info.status).toBe('revoked');
      expect(info.reason).toContain('revoked');
    });

    it('reports an expired cached QR as expired', async () => {
      const qr = await generatePetQRCode(mockPet, { expiry: '1h' });
      const data = parseQRCodeData(qr) as { expiresAt?: number };
      const expiresAt = data.expiresAt as number;

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(expiresAt + 1);
      try {
        const info = await getOfflineQRCodeInfo(mockPet.id);
        expect(info.status).toBe('expired');
        expect(info.reason).toContain('expired');
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('reports an unverifiable cached QR that cannot be decoded', async () => {
      await cacheQRPayload(mockPet.id, 'this-is-not-a-valid-petchain-qr');
      const info = await getOfflineQRCodeInfo(mockPet.id);

      expect(info.status).toBe('unverifiable');
    });

    it('reports an unverifiable v2 payload with no revocation metadata', async () => {
      const inPostscriptMetadata: Record<string, unknown> = {
        version: 2,
        petId: mockPet.id,
        deepLink: buildPetDeepLink(mockPet.id),
        generatedAt: Date.now(),
        checksum: 'placeholder-checksum',
        pet: {
          id: mockPet.id,
          name: mockPet.name,
          species: mockPet.species,
          breed: mockPet.breed,
          microchipId: mockPet.microchipId,
        },
      };
      const payload = encodePayload(inPostscriptMetadata);
      await cacheQRPayload(mockPet.id, payload);

      const info = await getOfflineQRCodeInfo(mockPet.id);
      expect(info.status).toBe('unverifiable');
      expect(info.reason).toContain('no revocation metadata');
    });

    it('reports not_found when no cache entry exists', async () => {
      const info = await getOfflineQRCodeInfo('pet-does-not-exist');
      expect(info.status).toBe('not_found');
      expect(info.payload).toBeNull();
    });
  });

  describe('markQRRevoked', () => {
    it('does not revoke a cache entry that does not embed the given token', async () => {
      await generatePetQRCode(mockPet);

      const changed = await markQRRevoked(mockPet.id, 'some-other-token');
      expect(changed).toBe(false);

      const info = await getOfflineQRCodeInfo(mockPet.id);
      expect(info.status).toBe('verified');
    });

    it('returns false for a pet with no cache entry', async () => {
      const changed = await markQRRevoked(mockPet.id, 'token');
      expect(changed).toBe(false);
    });
  });

  describe('revokeQRCode', () => {
    it('invalidates a cached QR so it is rejected by scanQRCode', async () => {
      const qr = await generatePetQRCode(mockPet);
      const token = (parseQRCodeData(qr) as { token?: string }).token as string;

      // Sanity: valid before revocation.
      expect((await scanQRCode(qr)).valid).toBe(true);

      await revokeQRCode(token);

      const scanned = await scanQRCode(qr);
      expect(scanned.valid).toBe(false);
      expect(scanned.error).toContain('revoked');
    });

    it('is a no-op for an unknown token', async () => {
      await expect(revokeQRCode('unknown-token')).resolves.toBeUndefined();
    });
  });
});
