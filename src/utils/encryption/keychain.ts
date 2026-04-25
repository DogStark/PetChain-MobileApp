import CryptoJS from 'crypto-js';
import * as SecureStore from 'expo-secure-store';
import * as Keychain from 'react-native-keychain';

import { EncryptionError } from './types';

const ENCRYPTION_KEY_USERNAME = 'PETCHAIN_ENCRYPTION_KEY';
const ENCRYPTION_KEY_SERVICE = 'com.petchain.auth.encryption';
const TOKEN_BLOB_KEY = 'com.petchain.auth.tokens';
const BIOMETRIC_FLAG_KEY = 'com.petchain.auth.biometric.enabled';
const BIOMETRIC_KEYCHAIN_SERVICE = 'com.petchain.auth.biometric';
const BIOMETRIC_USERNAME = 'petchain_biometric_user';
const BIOMETRIC_SECRET = 'petchain_biometric_unlock';

export interface SecureTokenPayload {
  token: string;
  refreshToken?: string;
}

export interface BiometricAvailability {
  isAvailable: boolean;
  biometryType: string | null;
}

type KeychainModule = typeof Keychain & {
  ACCESS_CONTROL?: {
    BIOMETRY_ANY?: string;
    BIOMETRY_CURRENT_SET?: string;
    BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE?: string;
    DEVICE_PASSCODE?: string;
  };
  SECURITY_LEVEL?: {
    ANY?: string;
    SECURE_HARDWARE?: string;
  };
  getSupportedBiometryType?: () => Promise<unknown>;
};

const keychainModule = Keychain as KeychainModule;
const secureStoreModule = SecureStore as typeof SecureStore & {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY?: string;
};

function getSecureStoreOptions() {
  return {
    keychainAccessible: secureStoreModule.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

function getBiometricAccessControl(): Keychain.ACCESS_CONTROL | undefined {
  if (keychainModule.ACCESS_CONTROL?.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE != null)
    return Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE;
  if (keychainModule.ACCESS_CONTROL?.BIOMETRY_CURRENT_SET != null)
    return Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET;
  if (keychainModule.ACCESS_CONTROL?.BIOMETRY_ANY != null)
    return Keychain.ACCESS_CONTROL.BIOMETRY_ANY;
  return undefined;
}

function getSecurityLevel(): Keychain.SECURITY_LEVEL | undefined {
  if (keychainModule.SECURITY_LEVEL?.SECURE_HARDWARE != null)
    return Keychain.SECURITY_LEVEL.SECURE_HARDWARE;
  if (keychainModule.SECURITY_LEVEL?.ANY != null) return Keychain.SECURITY_LEVEL.ANY;
  return undefined;
}

function generateEncryptionKey(): string {
  return CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex);
}

async function getRawEncryptionKey(): Promise<string | null> {
  try {
    const credentials = await Keychain.getGenericPassword({
      service: ENCRYPTION_KEY_SERVICE,
    });
    return credentials ? credentials.password : null;
  } catch {
    return null;
  }
}

async function ensureEncryptionKey(): Promise<string> {
  const existingKey = await getRawEncryptionKey();
  if (existingKey) {
    return existingKey;
  }

  const newKey = generateEncryptionKey();
  await storeEncryptionKey(newKey);
  return newKey;
}

function encryptTokenBlob(payload: SecureTokenPayload, key: string): string {
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(payload), key).toString();
  if (!encrypted) {
    throw new EncryptionError('Encryption produced empty result', 'ENCRYPTION_FAILED');
  }
  return encrypted;
}

function decryptTokenBlob(encryptedData: string, key: string): SecureTokenPayload {
  const bytes = CryptoJS.AES.decrypt(encryptedData, key);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);
  if (!decrypted) {
    throw new EncryptionError('Decryption failed - invalid data or wrong key', 'DECRYPTION_FAILED');
  }

  const parsed = JSON.parse(decrypted) as Partial<SecureTokenPayload>;
  if (!parsed.token || typeof parsed.token !== 'string') {
    throw new EncryptionError('Stored token payload is invalid', 'INVALID_TOKEN_PAYLOAD');
  }

  return {
    token: parsed.token,
    refreshToken:
      typeof parsed.refreshToken === 'string' && parsed.refreshToken.length > 0
        ? parsed.refreshToken
        : undefined,
  };
}

// Secure key storage
export const storeEncryptionKey = async (key: string): Promise<boolean> => {
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    throw new EncryptionError('Encryption key cannot be empty', 'INVALID_KEY');
  }

  try {
    await Keychain.setGenericPassword(ENCRYPTION_KEY_USERNAME, key, {
      service: ENCRYPTION_KEY_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      securityLevel: getSecurityLevel(),
    });
    return true;
  } catch (error) {
    throw new EncryptionError(
      `Failed to store encryption key: ${error instanceof Error ? error.message : 'Unknown keychain error'}`,
      'KEYCHAIN_STORE_ERROR',
    );
  }
};

export const getEncryptionKey = async (): Promise<string> => {
  const key = await getRawEncryptionKey();
  if (!key) {
    throw new EncryptionError('No encryption key found in keychain', 'KEY_NOT_FOUND');
  }
  return key;
};

export const storeSecureTokens = async (payload: SecureTokenPayload): Promise<void> => {
  if (!payload.token) {
    throw new EncryptionError('Access token is required', 'INVALID_TOKEN_PAYLOAD');
  }

  try {
    const key = await ensureEncryptionKey();
    const encryptedPayload = encryptTokenBlob(payload, key);
    await SecureStore.setItemAsync(TOKEN_BLOB_KEY, encryptedPayload, getSecureStoreOptions());
  } catch (error) {
    if (error instanceof EncryptionError) {
      throw error;
    }
    throw new EncryptionError(
      `Failed to store secure tokens: ${error instanceof Error ? error.message : 'Unknown secure storage error'}`,
      'TOKEN_STORE_ERROR',
    );
  }
};

export const getSecureTokens = async (): Promise<SecureTokenPayload | null> => {
  try {
    const encryptedPayload = await SecureStore.getItemAsync(
      TOKEN_BLOB_KEY,
      getSecureStoreOptions(),
    );
    if (!encryptedPayload) {
      return null;
    }

    const key = await ensureEncryptionKey();
    return decryptTokenBlob(encryptedPayload, key);
  } catch (error) {
    if (error instanceof EncryptionError) {
      throw error;
    }
    throw new EncryptionError(
      `Failed to retrieve secure tokens: ${error instanceof Error ? error.message : 'Unknown secure storage error'}`,
      'TOKEN_RETRIEVE_ERROR',
    );
  }
};

export const getSecureToken = async (): Promise<string | null> => {
  const payload = await getSecureTokens();
  return payload?.token ?? null;
};

export const getSecureRefreshToken = async (): Promise<string | null> => {
  const payload = await getSecureTokens();
  return payload?.refreshToken ?? null;
};

export const clearSecureTokens = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(TOKEN_BLOB_KEY, getSecureStoreOptions());
};

export const getBiometricAvailability = async (): Promise<BiometricAvailability> => {
  if (!keychainModule.getSupportedBiometryType) {
    return { isAvailable: false, biometryType: null };
  }

  try {
    const biometryType = await keychainModule.getSupportedBiometryType();
    return {
      isAvailable: !!biometryType,
      biometryType: typeof biometryType === 'string' ? biometryType : null,
    };
  } catch {
    return { isAvailable: false, biometryType: null };
  }
};

export const isBiometricAuthenticationEnabled = async (): Promise<boolean> => {
  try {
    const enabled = await SecureStore.getItemAsync(BIOMETRIC_FLAG_KEY, getSecureStoreOptions());
    return enabled === 'true';
  } catch {
    return false;
  }
};

export const enableBiometricAuthentication = async (
  promptMessage = 'Enable biometric login for faster, secure access',
): Promise<boolean> => {
  const { isAvailable } = await getBiometricAvailability();
  if (!isAvailable) {
    return false;
  }

  try {
    await Keychain.setGenericPassword(BIOMETRIC_USERNAME, BIOMETRIC_SECRET, {
      service: BIOMETRIC_KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      accessControl: getBiometricAccessControl(),
      securityLevel: getSecurityLevel(),
    });

    const credentials = await Keychain.getGenericPassword({
      service: BIOMETRIC_KEYCHAIN_SERVICE,
      authenticationPrompt: {
        title: promptMessage,
      },
    });

    if (!credentials) {
      return false;
    }

    await SecureStore.setItemAsync(BIOMETRIC_FLAG_KEY, 'true', getSecureStoreOptions());
    return true;
  } catch {
    return false;
  }
};

export const authenticateWithBiometricGate = async (
  promptMessage = 'Authenticate to access your PetChain account',
): Promise<boolean> => {
  if (!(await isBiometricAuthenticationEnabled())) {
    return false;
  }

  try {
    const credentials = await Keychain.getGenericPassword({
      service: BIOMETRIC_KEYCHAIN_SERVICE,
      authenticationPrompt: {
        title: promptMessage,
      },
    });

    return typeof credentials === 'object' && !!credentials && !!credentials.password;
  } catch {
    return false;
  }
};

export const disableBiometricAuthentication = async (): Promise<void> => {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(BIOMETRIC_FLAG_KEY, getSecureStoreOptions()),
    Keychain.resetGenericPassword({ service: BIOMETRIC_KEYCHAIN_SERVICE }),
  ]);
};
