import CryptoJS from 'crypto-js';
import * as SecureStore from 'expo-secure-store';

const SALT_PREFIX = 'com.petchain.encryption.salt.';

export interface DerivedKey {
  key: string;
  salt: string;
  iterations: number;
}

export async function deriveKeyFromSecret(
  secret: string,
  purpose = 'medical-records',
  salt?: string,
  iterations = 150000,
): Promise<DerivedKey> {
  const resolvedSalt = salt ?? CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
  const key = CryptoJS.PBKDF2(secret, `${purpose}:${resolvedSalt}`, {
    keySize: 256 / 32,
    iterations,
    hasher: CryptoJS.algo.SHA256,
  }).toString(CryptoJS.enc.Hex);

  await SecureStore.setItemAsync(`${SALT_PREFIX}${purpose}`, resolvedSalt);
  return { key, salt: resolvedSalt, iterations };
}

export async function getStoredSalt(purpose = 'medical-records'): Promise<string | null> {
  return SecureStore.getItemAsync(`${SALT_PREFIX}${purpose}`);
}
