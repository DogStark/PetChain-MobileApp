import { encrypt, decrypt, hashPassword } from '../encryption/crypto';
import { getEncryptionKey } from '../encryption/keychain';

jest.mock('../encryption/keychain', () => ({
  getEncryptionKey: jest.fn(),
}));

describe('crypto utils', () => {
  const mockKey = 'secret-key';

  beforeEach(() => {
    jest.clearAllMocks();
    (getEncryptionKey as jest.Mock).mockResolvedValue(mockKey);
  });

  it('should encrypt and decrypt data correctly', async () => {
    const data = 'sensitive information';
    const encrypted = await encrypt(data);
    expect(encrypted).not.toBe(data);

    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(data);
  });

  it('should throw error on invalid data type for encryption', async () => {
    await expect(encrypt(123 as any)).rejects.toThrow('Data to encrypt must be a string');
  });

  it('should throw error if decryption fails', async () => {
    await expect(decrypt('invalid-data')).rejects.toThrow('Decryption failed');
  });

  it('should hash passwords', () => {
    const password = 'my-password';
    const hash = hashPassword(password);
    expect(hash).toBeDefined();
    expect(hash).not.toBe(password);
    expect(hashPassword(password)).toBe(hash);
  });

  it('should throw error on empty password', () => {
    expect(() => hashPassword('')).toThrow('Password must be a non-empty string');
  });
});
