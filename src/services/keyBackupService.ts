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

export default {
  generateMnemonic,
  encryptMnemonic,
  decryptMnemonic,
  createBackupWithPin,
  retrieveMnemonicWithPin,
  createSocialShares,
  recoverFromShares,
};
