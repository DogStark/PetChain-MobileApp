import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Storage service for handling offline data storage
 * Provides wrapper functions for AsyncStorage with serialization/deserialization
 */

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Keys that hold unsynchronized user-authored drafts and must survive a clear.
 */
const PRESERVED_PREFIXES = ['@drafts'] as const;

function isPreservedKey(key: string): boolean {
  return PRESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Get data from storage
 * @param key - Storage key
 * @returns Parsed data or null if not found
 */
export async function get<T>(key: string): Promise<T | null> {
  try {
    const value = await AsyncStorage.getItem(key);
    if (value === null) {
      return null;
    }
    return JSON.parse(value) as T;
  } catch (error) {
    throw new StorageError(
      `Failed to get item with key "${key}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      'get',
    );
  }
}

/**
 * Set data in storage
 * @param key - Storage key
 * @param value - Data to store
 */
export async function set<T>(key: string, value: T): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    await AsyncStorage.setItem(key, serialized);
  } catch (error) {
    throw new StorageError(
      `Failed to set item with key "${key}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      'set',
    );
  }
}

/**
 * Remove data from storage
 * @param key - Storage key
 */
export async function remove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    throw new StorageError(
      `Failed to remove item with key "${key}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      'remove',
    );
  }
}

/**
 * Clear offline data from storage while preserving unsynchronized user-authored drafts.
 * Falls back to a full wipe only if key enumeration fails.
 */
export async function clear(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const removable = keys.filter((key) => !isPreservedKey(key));
    if (removable.length > 0) {
      await AsyncStorage.multiRemove(removable);
    }
  } catch {
    try {
      await AsyncStorage.clear();
    } catch (error) {
      throw new StorageError(
        `Failed to clear storage: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'clear',
      );
    }
  }
}

/**
 * Get multiple items from storage
 * @param keys - Array of storage keys
 * @returns Object with key-value pairs
 */
export async function getMultiple<T>(keys: string[]): Promise<Record<string, T | null>> {
  try {
    const pairs = await AsyncStorage.multiGet(keys);
    const result: Record<string, T | null> = {};

    for (const [key, value] of pairs) {
      result[key] = value ? (JSON.parse(value) as T) : null;
    }

    return result;
  } catch (error) {
    throw new StorageError(
      `Failed to get multiple items: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'getMultiple',
    );
  }
}

/**
 * Set multiple items in storage
 * @param items - Array of key-value pairs
 */
export async function setMultiple<T>(keys: string[], values: T[]): Promise<void> {
  try {
    const pairs = keys.map((key, index) => [key, values[index]] as [string, T]);
    const serialized = pairs.map(([key, value]) => [key, JSON.stringify(value)] as [string, string]);
    await AsyncStorage.multiSet(serialized);
  } catch (error) {
    throw new StorageError(
      `Failed to set multiple items: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'setMultiple',
    );
  }
}

/**
 * Remove multiple items from storage
 * @param keys - Array of storage keys
 */
export async function removeMultiple(keys: string[]): Promise<void> {
  try {
    await AsyncStorage.multiRemove(keys);
  } catch (error) {
    throw new StorageError(
      `Failed to remove multiple items: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'removeMultiple',
    );
  }
}

/**
 * Get all keys from storage
 * @returns Array of all storage keys
 */
export async function getAllKeys(): Promise<string[]> {
  try {
    return [...(await AsyncStorage.getAllKeys())];
  } catch (error) {
    throw new StorageError(
      `Failed to get all keys: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'getAllKeys',
    );
  }
}

export default {
  get,
  set,
  remove,
  clear,
  getMultiple,
  setMultiple,
  removeMultiple,
  getAllKeys,
  StorageError,
};
