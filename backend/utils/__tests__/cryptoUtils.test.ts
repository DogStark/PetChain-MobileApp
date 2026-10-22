import {
  decryptTOTPSeed,
  encryptTOTPSeed,
  isEncryptedPayload,
  type EncryptedPayload,
} from '../cryptoUtils';

const VALID_KEY = 'a'.repeat(64); // 32 bytes as hex

beforeEach(() => {
  process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
});

afterEach(() => {
  delete process.env.TOTP_ENCRYPTION_KEY;
});

describe('encrypt/decrypt round-trip', () => {
  it('decrypts back to the original plaintext', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const payload = encryptTOTPSeed(secret);
    expect(decryptTOTPSeed(payload)).toBe(secret);
  });

  it('produces different ciphertexts on each call (random IV)', () => {
    const secret = 'TESTSECRET123456';
    const a = encryptTOTPSeed(secret);
    const b = encryptTOTPSeed(secret);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('payload contains iv, authTag, and ciphertext fields', () => {
    const payload = encryptTOTPSeed('mysecret');
    expect(typeof payload.iv).toBe('string');
    expect(typeof payload.authTag).toBe('string');
    expect(typeof payload.ciphertext).toBe('string');
  });
});

describe('tampered authTag rejected', () => {
  it('throws when authTag is modified', () => {
    const payload = encryptTOTPSeed('JBSWY3DPEHPK3PXP');
    const tampered: EncryptedPayload = { ...payload, authTag: 'ff'.repeat(16) };
    expect(() => decryptTOTPSeed(tampered)).toThrow();
  });

  it('throws when ciphertext is modified', () => {
    const payload = encryptTOTPSeed('JBSWY3DPEHPK3PXP');
    const tampered: EncryptedPayload = {
      ...payload,
      ciphertext: 'deadbeef' + payload.ciphertext.slice(8),
    };
    expect(() => decryptTOTPSeed(tampered)).toThrow();
  });
});

describe('missing key throws on startup', () => {
  it('throws when TOTP_ENCRYPTION_KEY is not set', () => {
    delete process.env.TOTP_ENCRYPTION_KEY;
    expect(() => encryptTOTPSeed('secret')).toThrow('TOTP_ENCRYPTION_KEY');
  });

  it('throws when TOTP_ENCRYPTION_KEY is wrong length', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'tooshort';
    expect(() => encryptTOTPSeed('secret')).toThrow('TOTP_ENCRYPTION_KEY');
  });
});

describe('isEncryptedPayload', () => {
  it('returns true for a valid encrypted JSON payload', () => {
    const payload = encryptTOTPSeed('test');
    expect(isEncryptedPayload(JSON.stringify(payload))).toBe(true);
  });

  it('returns false for a plaintext secret', () => {
    expect(isEncryptedPayload('JBSWY3DPEHPK3PXP')).toBe(false);
  });

  it('returns false for arbitrary JSON without required fields', () => {
    expect(isEncryptedPayload(JSON.stringify({ foo: 'bar' }))).toBe(false);
  });
});
