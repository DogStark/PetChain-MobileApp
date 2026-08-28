import AsyncStorage from '@react-native-async-storage/async-storage';

import { encrypt, decrypt } from './encryption';

/**
 * A wrapper around AsyncStorage that encrypts values before storing them
 * and decrypts them after retrieving them.
 */
export const encryptedAsyncStorage = {
  /**
   * Set an item in storage with encryption
   */
  setItem: async (key: string, value: string): Promise<void> => {
    const encryptedValue = await encrypt(value, `async_storage_${key}`);
    await AsyncStorage.setItem(key, encryptedValue);
  },

  /**
   * Get an item from storage with decryption
   */
  getItem: async (key: string): Promise<string | null> => {
    const encryptedValue = await AsyncStorage.getItem(key);
    if (!encryptedValue) return null;
    try {
      return await decrypt(encryptedValue, `async_storage_${key}`);
    } catch (error) {
      console.error(`Failed to decrypt AsyncStorage key "${key}":`, error);
      return null;
    }
  },

  /**
   * Remove an item from storage
   */
  removeItem: async (key: string): Promise<void> => {
    await AsyncStorage.removeItem(key);
  },

  /**
   * Set multiple items in storage with encryption
   */
  multiSet: async (keyValuePairs: [string, string][]): Promise<void> => {
    const encryptedPairs: [string, string][] = await Promise.all(
      keyValuePairs.map(async ([key, value]) => {
        const encryptedValue = await encrypt(value, `async_storage_${key}`);
        return [key, encryptedValue] as [string, string];
      }),
    );
    await AsyncStorage.multiSet(encryptedPairs);
  },

  /**
   * Get multiple items from storage with decryption
   */
  multiGet: async (keys: string[]): Promise<[string, string | null][]> => {
    const pairs = await AsyncStorage.multiGet(keys);
    return await Promise.all(
      pairs.map(async ([key, encryptedValue]) => {
        if (!encryptedValue) return [key, null] as [string, string | null];
        try {
          const decryptedValue = await decrypt(encryptedValue, `async_storage_${key}`);
          return [key, decryptedValue] as [string, string | null];
        } catch (error) {
          console.error(`Failed to decrypt AsyncStorage key "${key}":`, error);
          return [key, null] as [string, string | null];
        }
      }),
    );
  },

  /**
   * Clear all items (Note: this clears everything, not just encrypted ones)
   */
  clear: async (): Promise<void> => {
    await AsyncStorage.clear();
  },

  /**
   * Get all keys
   */
  getAllKeys: async (): Promise<readonly string[]> => {
    return await AsyncStorage.getAllKeys();
  },
};
