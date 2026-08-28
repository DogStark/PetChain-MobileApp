import { randomBytes } from 'crypto';

import bcrypt from 'bcryptjs';
import { generateSecret as generateOtpSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';

import {
  decryptTOTPSeed,
  encryptTOTPSeed,
  isEncryptedPayload,
  type EncryptedPayload,
} from '../utils/cryptoUtils';

const BCRYPT_ROUNDS = 10;
const BACKUP_CODE_COUNT = 10;
const RECOVERY_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ── Secret & QR ───────────────────────────────────────────────────────────

export function generateSecret(): string {
  return generateOtpSecret({ length: 20 });
}

/**
 * Encrypt a TOTP seed before storing it in the database.
 * Returns a JSON string containing (iv, authTag, ciphertext).
 */
export function encryptSeed(plainSecret: string): string {
  return JSON.stringify(encryptTOTPSeed(plainSecret));
}

/**
 * Decrypt a TOTP seed retrieved from the database.
 */
export function decryptSeed(storedValue: string): string {
  const payload = JSON.parse(storedValue) as EncryptedPayload;
  return decryptTOTPSeed(payload);
}

/**
 * One-off migration helper: re-encrypts any plaintext seeds already stored in the DB.
 * Pass each raw `seed` column value; if it is plaintext, returns the encrypted form.
 * If already encrypted, returns the value unchanged.
 */
export function migrateSeedException(rawSeedValue: string): string {
  if (isEncryptedPayload(rawSeedValue)) return rawSeedValue; // already encrypted
  return encryptSeed(rawSeedValue);
}

export async function generateQRCodeDataURL(
  secret: string,
  email: string,
  issuer = 'PetChain',
): Promise<string> {
  const otpauth = generateURI({
    issuer,
    label: email,
    secret,
  });
  return QRCode.toDataURL(otpauth);
}

// ── TOTP verification ──────────────────────────────────────────────────────

/**
 * Verify a TOTP token against a stored seed.
 * `storedSeed` may be either a raw plaintext secret (legacy) or
 * an encrypted JSON payload produced by `encryptSeed()`.
 */
export function verifyTOTP(token: string, storedSeed: string): boolean {
  try {
    const plainSecret = isEncryptedPayload(storedSeed) ? decryptSeed(storedSeed) : storedSeed;
    return verifySync({ token, secret: plainSecret }).valid;
  } catch {
    return false;
  }
}

// ── Backup codes ───────────────────────────────────────────────────────────

function randomCode(): string {
  return randomBytes(8).toString('hex').toUpperCase().slice(0, 10);
}

export async function generateBackupCodes(): Promise<{ plain: string[]; hashed: string[] }> {
  const plain: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = randomCode();
    plain.push(code);
    hashed.push(await bcrypt.hash(code, BCRYPT_ROUNDS));
  }
  return { plain, hashed };
}

/** Returns the index of the matched hash (for single-use removal), or -1. */
export async function verifyBackupCode(code: string, hashedCodes: string[]): Promise<number> {
  for (let i = 0; i < hashedCodes.length; i++) {
    if (await bcrypt.compare(code.toUpperCase(), hashedCodes[i])) return i;
  }
  return -1;
}

// ── Recovery tokens ────────────────────────────────────────────────────────

export interface RecoveryToken {
  token: string;
  hashedToken: string;
  expiresAt: number; // epoch ms
}

export async function generateRecoveryToken(): Promise<RecoveryToken> {
  const token = randomBytes(32).toString('hex');
  const hashedToken = await bcrypt.hash(token, BCRYPT_ROUNDS);
  return { token, hashedToken, expiresAt: Date.now() + RECOVERY_TOKEN_TTL_MS };
}

export async function verifyRecoveryToken(
  token: string,
  hashedToken: string,
  expiresAt: number,
): Promise<boolean> {
  if (Date.now() > expiresAt) return false;
  return bcrypt.compare(token, hashedToken);
}
