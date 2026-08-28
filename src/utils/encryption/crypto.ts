import CryptoJS from 'crypto-js';

import { getEncryptionKey } from './keychain';
import { EncryptionError } from './types';

/**
 * Derives a sub-key from the master encryption key using PBKDF2.
 * This ensures that different storage areas use different keys.
 *
 * @param purpose - A string identifying the purpose of the key (e.g., 'storage', 'auth')
 * @param salt - An optional salt. If not provided, a default one based on purpose is used.
 * @returns A derived key as a string
 */
export const deriveKey = async (purpose: string, salt?: string): Promise<string> => {
  try {
    const masterKey = await getEncryptionKey();
    const derivationSalt = salt || CryptoJS.SHA256(purpose).toString();

    // Use PBKDF2 for key derivation
    const derived = CryptoJS.PBKDF2(masterKey, derivationSalt, {
      keySize: 256 / 32,
      iterations: 1000,
    });

    return derived.toString();
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    throw new EncryptionError(
      `Key derivation failed: ${error instanceof Error ? error.message : 'Unknown crypto error'}`,
      'KEY_DERIVATION_ERROR',
    );
  }
};

/**
 * Encrypts a string or object using the derived key for the given purpose.
 */
export const encrypt = async (data: unknown, purpose: string = 'general'): Promise<string> => {
  if (data === null || data === undefined) {
    throw new EncryptionError('Data to encrypt cannot be null or undefined', 'INVALID_DATA');
  }

  if (typeof data !== 'string') {
    throw new EncryptionError('Data to encrypt must be a string', 'INVALID_DATA');
  }

  try {
    const key = await deriveKey(purpose);
    const encrypted = CryptoJS.AES.encrypt(data, key).toString();
    if (!encrypted) {
      throw new EncryptionError('Encryption produced empty result', 'ENCRYPTION_FAILED');
    }
    return encrypted;
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    throw new EncryptionError(
      `Encryption failed: ${error instanceof Error ? error.message : 'Unknown crypto error'}`,
      'CRYPTO_ERROR',
    );
  }
};

/**
 * Decrypts a string and optionally parses it as JSON.
 */
export const decrypt = async <T = string>(
  encryptedData: string,
  purpose: string = 'general',
  parseJson: boolean = false,
): Promise<T> => {
  if (!encryptedData || typeof encryptedData !== 'string') {
    throw new EncryptionError(
      'Encrypted data must be a non-empty string',
      'INVALID_ENCRYPTED_DATA',
    );
  }

  try {
    const key = await deriveKey(purpose);
    const bytes = CryptoJS.AES.decrypt(encryptedData, key);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);

    if (!decrypted) {
      throw new EncryptionError(
        'Decryption failed - invalid data or wrong key',
        'DECRYPTION_FAILED',
      );
    }

    if (parseJson) {
      try {
        return JSON.parse(decrypted) as T;
      } catch {
        throw new EncryptionError('Failed to parse decrypted data as JSON', 'JSON_PARSE_ERROR');
      }
    }

    return decrypted as unknown as T;
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    throw new EncryptionError(
      `Decryption failed: ${error instanceof Error ? error.message : 'Unknown crypto error'}`,
      'CRYPTO_ERROR',
    );
  }
};

// Hash function for passwords
export const hashPassword = (password: string): string => {
  if (!password || typeof password !== 'string') {
    throw new EncryptionError('Password must be a non-empty string', 'INVALID_PASSWORD');
  }

  try {
    const hash = CryptoJS.SHA256(password).toString();
    if (!hash) {
      throw new EncryptionError('Password hashing produced empty result', 'HASH_FAILED');
    }
    return hash;
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    throw new EncryptionError(
      `Password hashing failed: ${error instanceof Error ? error.message : 'Unknown crypto error'}`,
      'CRYPTO_ERROR',
    );
  }
};
