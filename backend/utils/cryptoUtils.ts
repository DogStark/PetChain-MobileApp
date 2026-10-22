import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedPayload {
  iv: string;
  authTag: string;
  ciphertext: string;
}

function loadKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOTP_ENCRYPTION_KEY environment variable is not set');
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32)
    throw new Error('TOTP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  return key;
}

export function encryptTOTPSeed(plaintext: string): EncryptedPayload {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

export function decryptTOTPSeed(payload: EncryptedPayload): string {
  const key = loadKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * Detects whether a stored seed value is already an encrypted JSON payload or plaintext.
 * Used for the one-off migration of existing plaintext seeds.
 */
export function isEncryptedPayload(value: string): boolean {
  try {
    const obj = JSON.parse(value) as unknown;
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'iv' in obj &&
      'authTag' in obj &&
      'ciphertext' in obj
    );
  } catch {
    return false;
  }
}
