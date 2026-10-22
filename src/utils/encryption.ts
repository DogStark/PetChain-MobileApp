/**
 * Encryption Utility — Issue #811
 *
 * Provides high-level encrypt/decrypt/generateKey helpers for sensitive data
 * stored locally (tokens, personal data). Sensitive values are never stored
 * as plain text; all persistence goes through react-native-keychain via the
 * underlying keychain module.
 *
 * Thin wrapper around src/utils/encryption/* so callers have a single,
 * stable import path.
 */

import CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';

import { EncryptionError } from './encryption/types';

// ─────────────────────────────────────────────────────────────────────────────
// Re-export low-level primitives for consumers that need them
// ─────────────────────────────────────────────────────────────────────────────
export { EncryptionError } from './encryption/types';
export {
  storeEncryptionKey,
  getEncryptionKey,
  storeSecureTokens,
  getSecureTokens,
  getSecureToken,
  getSecureRefreshToken,
  clearSecureTokens,
  getBiometricAvailability,
  isBiometricAuthenticationEnabled,
  enableBiometricAuthentication,
  authenticateWithBiometricGate,
  disableBiometricAuthentication,
} from './encryption/keychain';
export { hashPassword, deriveKey } from './encryption/crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const KEY_SERVICE = 'com.petchain.encryption.utility';
const KEY_USERNAME = 'PETCHAIN_UTILITY_KEY';

// ─────────────────────────────────────────────────────────────────────────────
// generateKey
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random 256-bit key and stores it securely
 * in the device keychain via react-native-keychain.
 *
 * Returns the key as a hex string. Storing it is a side-effect so callers
 * that only need an ephemeral key can discard the return value.
 */
export async function generateKey(): Promise<string> {
  // 256 bits = 32 bytes → 64 hex chars
  const wordArray = CryptoJS.lib.WordArray.random(32);
  const key = wordArray.toString(CryptoJS.enc.Hex);

  // Persist in keychain so it survives app restarts
  await Keychain.setGenericPassword(KEY_USERNAME, key, {
    service: KEY_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });

  return key;
}

// ─────────────────────────────────────────────────────────────────────────────
// encrypt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypts `data` with `key` using AES-256.
 *
 * @param data - Plain-text string to encrypt. Pass JSON.stringify() for objects.
 * @param key  - Encryption key (hex string). Use generateKey() to produce one.
 * @returns    - Ciphertext string (CryptoJS AES format).
 *
 * @throws {EncryptionError} on invalid inputs or crypto failure.
 */
export function encrypt(data: string, key: string): string {
  if (!data || typeof data !== 'string') {
    throw new EncryptionError('Data to encrypt must be a non-empty string', 'INVALID_DATA');
  }
  if (!key || typeof key !== 'string') {
    throw new EncryptionError('Encryption key must be a non-empty string', 'INVALID_KEY');
  }

  try {
    const ciphertext = CryptoJS.AES.encrypt(data, key).toString();
    if (!ciphertext) {
      throw new EncryptionError('Encryption produced empty result', 'ENCRYPTION_FAILED');
    }
    return ciphertext;
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    throw new EncryptionError(
      `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'CRYPTO_ERROR',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// decrypt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decrypts an AES-encrypted ciphertext string produced by `encrypt()`.
 *
 * @param ciphertext - Encrypted string.
 * @param key        - The same key used to encrypt.
 * @returns          - Decrypted plain-text string.
 *
 * @throws {EncryptionError} on invalid inputs, wrong key, or corrupt data.
 */
export function decrypt(ciphertext: string, key: string): string {
  if (!ciphertext || typeof ciphertext !== 'string') {
    throw new EncryptionError(
      'Ciphertext must be a non-empty string',
      'INVALID_ENCRYPTED_DATA',
    );
  }
  if (!key || typeof key !== 'string') {
    throw new EncryptionError('Decryption key must be a non-empty string', 'INVALID_KEY');
  }

  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key);
    const plaintext = bytes.toString(CryptoJS.enc.Utf8);

    if (!plaintext) {
      throw new EncryptionError(
        'Decryption failed — invalid ciphertext or wrong key',
        'DECRYPTION_FAILED',
      );
    }
    return plaintext;
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    throw new EncryptionError(
      `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'CRYPTO_ERROR',
    );
  }
}
