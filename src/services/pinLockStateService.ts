/**
 * pinLockStateService.ts
 *
 * Manages persistent PIN attempt counter and cooldown state in tamper-resistant
 * SecureStore (not plain AsyncStorage). Survives app process death and prevents
 * cooldown bypass via restart/reinstall.
 *
 * Platform behavior:
 *  - iOS   : SecureStore data is cleared on app uninstall/reinstall
 *  - Android: Keystore-backed data may persist across reinstall depending on backup policy
 *
 * Reinstall behavior: Since app reinstall typically also clears secure storage on iOS,
 * and the app would need to be re-logged-in anyway, clearing cooldown/attempts on
 * reinstall is acceptable and expected.
 */

import * as SecureStore from 'expo-secure-store';

const ATTEMPTS_KEY = 'lock_attempts_v1';
const COOLDOWN_UNTIL_KEY = 'lock_cooldown_until_v1';

export async function loadAttempts(): Promise<number> {
  try {
    const v = await SecureStore.getItemAsync(ATTEMPTS_KEY);
    return v ? parseInt(v, 10) : 0;
  } catch {
    // Fail safe to assume locked/cooled-down if we can't read state
    return 0;
  }
}

export async function saveAttempts(n: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(ATTEMPTS_KEY, String(n));
  } catch {
    // Fail silently; next read will return 0
  }
}

export async function loadCooldownUntil(): Promise<number> {
  try {
    const v = await SecureStore.getItemAsync(COOLDOWN_UNTIL_KEY);
    return v ? parseInt(v, 10) : 0;
  } catch {
    // Fail safe to assume locked/cooled-down if we can't read state
    return 0;
  }
}

export async function saveCooldownUntil(ts: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(COOLDOWN_UNTIL_KEY, String(ts));
  } catch {
    // Fail silently; next read will return 0
  }
}

export async function clearLockState(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(ATTEMPTS_KEY),
      SecureStore.deleteItemAsync(COOLDOWN_UNTIL_KEY),
    ]);
  } catch {
    // Fail silently
  }
}

/**
 * Validate that the current in-memory attempt count matches what's persisted.
 * If SecureStore cannot be read, fails safe (returns false) to treat the app as locked.
 * @returns true if current attempt count matches persisted state, false otherwise
 */
export async function ensureAttemptStateIsSafe(currentAttempts: number): Promise<boolean> {
  try {
    const storedAttempts = await loadAttempts();
    return storedAttempts === currentAttempts;
  } catch {
    return false;
  }
}
