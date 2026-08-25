import {
  generatePetQRCode,
  generateQR,
  getQRImageUrl,
  parseQRCodeData,
  validateQRCode,
} from '../qrCodeService';

// ✅ LOCAL TYPES (no dependency on service exports)
type Species = 'dog' | 'cat' | 'bird';

type Pet = {
  id: string;
  name: string;
  species: Species;
  ownerId: string;
  qrCode: string;
  createdAt: string;
  updatedAt: string;
};

const mockPet: Pet = {
  id: 'pet-123',
  name: 'Buddy',
  species: 'dog',
  ownerId: 'user-1',
  qrCode: 'qr',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

describe('qrCodeService', () => {
  describe('generatePetQRCode', () => {
    it('should generate QR code', async () => {
      const qrCode = await generatePetQRCode(mockPet);

      expect(typeof qrCode).toBe('string');
      expect(qrCode.length).toBeGreaterThan(0);

      const parsed = parseQRCodeData(qrCode);
      expect(parsed.petId).toBe(mockPet.id);
    });

    it('should throw for empty id', async () => {
      await expect(generatePetQRCode({ ...mockPet, id: '' })).rejects.toThrow();
    });

    it('should throw for invalid id', async () => {
      await expect(generatePetQRCode({ ...mockPet, id: 'bad id' })).rejects.toThrow();
    });
  });

  describe('generateQR', () => {
    it('encodes pet data and builds an image URL', async () => {
      const qrCode = await generateQR(mockPet);
      const imageUrl = getQRImageUrl(qrCode);

      expect(parseQRCodeData(qrCode).petId).toBe(mockPet.id);
      expect(imageUrl).toContain(encodeURIComponent(qrCode));
    });
  });

  describe('parseQRCodeData', () => {
    it('should parse valid QR', async () => {
      const qrCode = await generatePetQRCode(mockPet);
      const parsed = parseQRCodeData(qrCode);

      expect(parsed.petId).toBe(mockPet.id);
    });
  });

  describe('validateQRCode', () => {
    it('should validate correct QR', async () => {
      const qrCode = await generatePetQRCode(mockPet);
      const result = await validateQRCode(qrCode);

      expect(result.valid).toBe(true);
    });

    it('should reject tampered QR', async () => {
      const result = await validateQRCode('tampered');
      expect(result.valid).toBe(false);
    });
  });
});
