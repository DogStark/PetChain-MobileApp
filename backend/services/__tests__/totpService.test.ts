/**
 * Tests for TOTP seed encryption at rest (Issue #525).
 */

// Use a valid 64-character hex key before importing the module
const TEST_KEY = 'a'.repeat(64); // 32 bytes of 0xaa

describe('cryptoUtils — TOTP seed encryption', () => {
  let encryptTOTPSeed: (p: string) => { iv: string; authTag: string; ciphertext: string };
  let decryptTOTPSeed: (p: { iv: string; authTag: string; ciphertext: string }) => string;

  beforeAll(() => {
    process.env.TOTP_ENCRYPTION_KEY = TEST_KEY;
    const mod = require('../../utils/cryptoUtils');
    encryptTOTPSeed = mod.encryptTOTPSeed;
    decryptTOTPSeed = mod.decryptTOTPSeed;
  });

  afterAll(() => {
    delete process.env.TOTP_ENCRYPTION_KEY;
  });

  it('round-trips a plaintext seed', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const payload = encryptTOTPSeed(secret);
    expect(decryptTOTPSeed(payload)).toBe(secret);
  });

  it('produces different ciphertext on each call (random IV)', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const a = encryptTOTPSeed(secret);
    const b = encryptTOTPSeed(secret);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects a tampered authTag', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const payload = encryptTOTPSeed(secret);
    // Flip last byte of authTag
    const tagBuf = Buffer.from(payload.authTag, 'hex');
    tagBuf[tagBuf.length - 1] ^= 0xff;
    const tampered = { ...payload, authTag: tagBuf.toString('hex') };
    expect(() => decryptTOTPSeed(tampered)).toThrow();
  });
});

describe('cryptoUtils — missing key', () => {
  it('throws on startup when TOTP_ENCRYPTION_KEY is absent', () => {
    delete process.env.TOTP_ENCRYPTION_KEY;
    jest.resetModules();
    const mod = require('../../utils/cryptoUtils');
    expect(() => mod.encryptTOTPSeed('anything')).toThrow('TOTP_ENCRYPTION_KEY');
  });
});

describe('totpService — encrypt/decrypt helpers', () => {
  beforeAll(() => {
    process.env.TOTP_ENCRYPTION_KEY = TEST_KEY;
    jest.resetModules();
  });

  afterAll(() => {
    delete process.env.TOTP_ENCRYPTION_KEY;
    jest.resetModules();
  });

  it('encryptSeed produces a JSON string with iv/authTag/ciphertext', () => {
    const { encryptSeed } = require('../totpService');
    const stored = encryptSeed('MYSECRET');
    const parsed = JSON.parse(stored);
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('authTag');
    expect(parsed).toHaveProperty('ciphertext');
  });

  it('decryptSeed recovers the original secret', () => {
    const { encryptSeed, decryptSeed } = require('../totpService');
    const secret = 'BASE32SECRETVALUE';
    expect(decryptSeed(encryptSeed(secret))).toBe(secret);
  });

  it('migrateSeedException: leaves already-encrypted value unchanged', () => {
    const { encryptSeed, migrateSeedException } = require('../totpService');
    const encrypted = encryptSeed('MYSECRET');
    expect(migrateSeedException(encrypted)).toBe(encrypted);
  });

  it('migrateSeedException: encrypts a plaintext seed', () => {
    const { migrateSeedException, decryptSeed } = require('../totpService');
    const plaintext = 'PLAINTEXTSEED1234';
    const migrated = migrateSeedException(plaintext);
    expect(decryptSeed(migrated)).toBe(plaintext);
  });
});
