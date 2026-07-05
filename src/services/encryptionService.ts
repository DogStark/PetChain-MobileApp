import CryptoJS from 'crypto-js';
import * as SecureStore from 'expo-secure-store';

import { deriveKeyFromSecret, getStoredSalt } from '../utils/keyDerivation';

const KEY_VERSION_KEY = 'com.petchain.encryption.keyVersion';
const KEY_MATERIAL_PREFIX = 'com.petchain.encryption.key.';

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
  algorithm: 'AES-256-GCM';
}

export class EncryptionService {
  async provisionKey(secret: string, version = 1): Promise<void> {
    const existingSalt = await getStoredSalt();
    const derived = await deriveKeyFromSecret(secret, 'medical-records', existingSalt ?? undefined);
    await SecureStore.setItemAsync(`${KEY_MATERIAL_PREFIX}${version}`, derived.key);
    await SecureStore.setItemAsync(KEY_VERSION_KEY, String(version));
  }

  async encryptRecord(payload: unknown): Promise<EncryptedPayload> {
    const keyVersion = await this.getCurrentKeyVersion();
    const key = await this.getKey(keyVersion);
    const parsedKey = CryptoJS.enc.Hex.parse(key);
    const iv = CryptoJS.lib.WordArray.random(12).toString(CryptoJS.enc.Hex);
    const encrypted = CryptoJS.AES.encrypt(JSON.stringify(payload), parsedKey, {
      iv: CryptoJS.enc.Hex.parse(iv),
    });
    const ciphertext = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
    const tag = CryptoJS.HmacSHA256(`${iv}:${ciphertext}`, parsedKey).toString(CryptoJS.enc.Hex);
    return { ciphertext, iv, tag, keyVersion, algorithm: 'AES-256-GCM' };
  }

  async decryptRecord<T = unknown>(payload: EncryptedPayload): Promise<T> {
    const key = await this.getKey(payload.keyVersion);
    const parsedKey = CryptoJS.enc.Hex.parse(key);
    const expectedTag = CryptoJS.HmacSHA256(
      `${payload.iv}:${payload.ciphertext}`,
      parsedKey,
    ).toString(CryptoJS.enc.Hex);
    if (expectedTag !== payload.tag) throw new Error('Encrypted record authentication failed');

    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(payload.ciphertext) } as CryptoJS.lib.CipherParams,
      parsedKey,
      { iv: CryptoJS.enc.Hex.parse(payload.iv) },
    ).toString(CryptoJS.enc.Utf8);

    if (!decrypted) throw new Error('Encrypted record decryption failed');
    return JSON.parse(decrypted) as T;
  }

  async rotateKey(
    secret: string,
    encryptedRecords: EncryptedPayload[],
  ): Promise<EncryptedPayload[]> {
    const nextVersion = (await this.getCurrentKeyVersion()) + 1;
    const decrypted = await Promise.all(
      encryptedRecords.map((record) => this.decryptRecord(record)),
    );
    await this.provisionKey(secret, nextVersion);
    return Promise.all(decrypted.map((record) => this.encryptRecord(record)));
  }

  async mergeEncryptedRecords(
    client: EncryptedPayload,
    server: EncryptedPayload,
    merge: (
      client: Record<string, unknown>,
      server: Record<string, unknown>,
    ) => Record<string, unknown>,
  ): Promise<EncryptedPayload> {
    const clientRecord = await this.decryptRecord<Record<string, unknown>>(client);
    const serverRecord = await this.decryptRecord<Record<string, unknown>>(server);
    return this.encryptRecord(merge(clientRecord, serverRecord));
  }

  private async getCurrentKeyVersion(): Promise<number> {
    const stored = await SecureStore.getItemAsync(KEY_VERSION_KEY);
    return stored ? Number(stored) : 1;
  }

  private async getKey(version: number): Promise<string> {
    const key = await SecureStore.getItemAsync(`${KEY_MATERIAL_PREFIX}${version}`);
    if (!key) throw new Error(`Encryption key version ${version} is not provisioned`);
    return key;
  }
}

export const encryptionService = new EncryptionService();
export default encryptionService;
