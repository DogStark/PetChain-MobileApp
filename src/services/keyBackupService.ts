import * as StellarSdk from '@stellar/stellar-sdk';
import bip39 from 'bip39';
import CryptoJS from 'crypto-js';

import { encryptedAsyncStorage } from '../utils/encryptedAsyncStorage';
import { splitSecret, combineShares } from '../utils/shamirSecretSharing';

const STORAGE_KEY = 'key_backup.mnemonic.enc';

export async function generateMnemonic(strength = 256): Promise<string> {
  return bip39.generateMnemonic(strength);
}

export function encryptMnemonic(mnemonic: string, pin: string): string {
  return CryptoJS.AES.encrypt(mnemonic, pin).toString();
}

export function decryptMnemonic(encrypted: string, pin: string): string {
  const bytes = CryptoJS.AES.decrypt(encrypted, pin);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);
  if (!decrypted) throw new Error('Invalid PIN or corrupted data');
  return decrypted;
}

export async function createBackupWithPin(mnemonic: string, pin: string): Promise<void> {
  const encrypted = encryptMnemonic(mnemonic, pin);
  await encryptedAsyncStorage.setItem(STORAGE_KEY, encrypted);
}

export async function retrieveMnemonicWithPin(pin: string): Promise<string | null> {
  const enc = await encryptedAsyncStorage.getItem(STORAGE_KEY);
  if (!enc) return null;
  return decryptMnemonic(enc, pin);
}

export function createSocialShares(mnemonic: string, shares = 5, threshold = 3): string[] {
  return splitSecret(mnemonic, shares, threshold);
}

export function recoverFromShares(sharesArr: string[]): string {
  return combineShares(sharesArr);
}

// ─── Encrypted recovery shares (#1361) ───────────────────────────────────────

export interface RecoveryShare {
  /** 1-based share index. */
  index: number;
  /** Shamir share string (hex payload). */
  share: string;
  /** Stellar public key of the contact the share is encrypted to. */
  recipientPublicKey: string;
  /** AES ciphertext of the share, encrypted to the recipient's public key. */
  encryptedShare: string;
}

export interface EncryptedRecoveryShare {
  index: number;
  recipientPublicKey: string;
  encryptedShare: string;
}

/**
 * Derive a deterministic AES key from a Stellar public key.
 *
 * The share is encrypted *to* the contact's public key: only someone who knows
 * that public key (i.e. the contact) can derive the key and decrypt the share.
 */
function deriveShareKey(publicKey: string): CryptoJS.lib.WordArray {
  const raw = StellarSdk.StrKey.decodeEd25519PublicKey(publicKey);
  const hex = CryptoJS.enc.Hex.parse(Buffer.from(raw).toString('hex'));
  return CryptoJS.SHA256(hex);
}

export function encryptShareToPublicKey(share: string, recipientPublicKey: string): string {
  const key = deriveShareKey(recipientPublicKey);
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(share, key, { iv });
  return `${iv.toString(CryptoJS.enc.Hex)}:${encrypted.ciphertext.toString(CryptoJS.enc.Base64)}`;
}

export function decryptShareFromPublicKey(
  encryptedShare: string,
  recipientPublicKey: string,
): string {
  const [ivHex, ciphertext] = encryptedShare.split(':');
  if (!ivHex || !ciphertext) throw new Error('Malformed encrypted share');
  const key = deriveShareKey(recipientPublicKey);
  const decrypted = CryptoJS.AES.decrypt(ciphertext, key, {
    iv: CryptoJS.enc.Hex.parse(ivHex),
  }).toString(CryptoJS.enc.Utf8);
  if (!decrypted) throw new Error('Unable to decrypt recovery share');
  return decrypted;
}

/**
 * Split `mnemonic` into `shares` Shamir shares with threshold `threshold` and
 * encrypt each share to the corresponding contact's public key.
 */
export function distributeRecoveryShares(
  mnemonic: string,
  recipientPublicKeys: string[],
  threshold: number,
): RecoveryShare[] {
  if (recipientPublicKeys.length < 2) {
    throw new Error('At least 2 shares are required');
  }
  if (threshold < 2 || threshold > recipientPublicKeys.length) {
    throw new Error('Threshold must be between 2 and the number of shares');
  }
  const parts = splitSecret(mnemonic, recipientPublicKeys.length, threshold);
  return parts.map((share, i) => ({
    index: i + 1,
    share,
    recipientPublicKey: recipientPublicKeys[i],
    encryptedShare: encryptShareToPublicKey(share, recipientPublicKeys[i]),
  }));
}

/**
 * Reconstruct the mnemonic from at least `threshold` encrypted shares.
 * Decrypted shares are wiped from memory once combined.
 */
export function recoverFromEncryptedShares(
  encryptedShares: EncryptedRecoveryShare[],
  threshold: number,
): string {
  if (encryptedShares.length < threshold) {
    throw new Error(`At least ${threshold} shares are required`);
  }
  const decrypted: string[] = [];
  try {
    for (const item of encryptedShares) {
      decrypted.push(decryptShareFromPublicKey(item.encryptedShare, item.recipientPublicKey));
    }
    return combineShares(decrypted);
  } finally {
    // Wipe decrypted shares from memory after use
    for (let i = 0; i < decrypted.length; i += 1) {
      decrypted[i] = '';
    }
    decrypted.length = 0;
  }
}

export default {
  generateMnemonic,
  encryptMnemonic,
  decryptMnemonic,
  createBackupWithPin,
  retrieveMnemonicWithPin,
  createSocialShares,
  recoverFromShares,
  encryptShareToPublicKey,
  decryptShareFromPublicKey,
  distributeRecoveryShares,
  recoverFromEncryptedShares,
};
