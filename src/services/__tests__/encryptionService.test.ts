const secureStore: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn((key: string, value: string) => {
    secureStore[key] = value;
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) => Promise.resolve(secureStore[key] ?? null)),
  deleteItemAsync: jest.fn((key: string) => {
    delete secureStore[key];
    return Promise.resolve();
  }),
}));

import { EncryptionService } from '../encryptionService';

describe('EncryptionService', () => {
  beforeEach(() => {
    Object.keys(secureStore).forEach((key) => delete secureStore[key]);
  });

  it('encrypts and decrypts medical record payloads', async () => {
    const service = new EncryptionService();
    await service.provisionKey('123456');

    const encrypted = await service.encryptRecord({ id: 'mr1', diagnosis: 'healthy' });
    const decrypted = await service.decryptRecord(encrypted);

    expect(encrypted.algorithm).toBe('AES-256-GCM');
    expect(decrypted).toEqual({ id: 'mr1', diagnosis: 'healthy' });
  });

  it('rotates keys without data loss', async () => {
    const service = new EncryptionService();
    await service.provisionKey('123456');
    const encrypted = await service.encryptRecord({ id: 'mr1', notes: 'v1' });

    const rotated = await service.rotateKey('654321', [encrypted]);
    const decrypted = await service.decryptRecord(rotated[0]);

    expect(rotated[0].keyVersion).toBe(2);
    expect(decrypted).toEqual({ id: 'mr1', notes: 'v1' });
  });
});
