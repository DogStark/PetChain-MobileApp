/**
 * storage.ts
 *
 * Typed wrapper around AsyncStorage that handles JSON serialisation,
 * deserialisation, and storage error normalisation so callers never have
 * to deal with raw string values or try/catch boilerplate.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly key: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Retrieve a typed value from AsyncStorage.
 *
 * Returns `null` when the key does not exist.
 * Throws `StorageError` on read or parse failures.
 *
 * @example
 * const user = await getItem<User>('@current_user');
 */
export async function getItem<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new StorageError(`Failed to read key "${key}" from storage`, key, cause);
  }
}

/**
 * Persist a value to AsyncStorage as JSON.
 *
 * Throws `StorageError` on serialisation or write failures.
 *
 * @example
 * await setItem('@current_user', user);
 */
export async function setItem<T>(key: string, value: T): Promise<void> {
  try {
    const serialised = JSON.stringify(value);
    await AsyncStorage.setItem(key, serialised);
  } catch (cause) {
    throw new StorageError(`Failed to write key "${key}" to storage`, key, cause);
  }
}

/**
 * Delete a single key from AsyncStorage.
 *
 * Throws `StorageError` on failure.
 *
 * @example
 * await removeItem('@current_user');
 */
export async function removeItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (cause) {
    throw new StorageError(`Failed to remove key "${key}" from storage`, key, cause);
  }
}

/**
 * Wipe every key from AsyncStorage.
 *
 * ⚠️ This erases ALL stored data for the app — use with care.
 *
 * Throws `StorageError` on failure.
 */
export async function clearAll(): Promise<void> {
  try {
    await AsyncStorage.clear();
  } catch (cause) {
    throw new StorageError('Failed to clear AsyncStorage', '*', cause);
  }
}
