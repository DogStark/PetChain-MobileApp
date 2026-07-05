/**
 * Haptic feedback utility for PetChain.
 *
 * Wraps expo-haptics with a user-configurable enable/disable toggle
 * stored in AsyncStorage under the key `hapticFeedbackEnabled`.
 *
 * Use `setHapticEnabled(false)` from accessibility settings to opt out.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

const STORAGE_KEY = 'hapticFeedbackEnabled';

/** Returns true when haptic feedback is enabled (default: true). */
export async function isHapticEnabled(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    // Treat null (never set) as enabled
    return value !== 'false';
  } catch {
    return true;
  }
}

/** Persist the user's haptic preference. */
export async function setHapticEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Silently ignore storage errors
  }
}

/** Light impact — used for per-second countdown ticks. */
export async function hapticLight(): Promise<void> {
  if (!(await isHapticEnabled())) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Device may not support haptics; ignore
  }
}

/** Medium impact — used for cancel. */
export async function hapticMedium(): Promise<void> {
  if (!(await isHapticEnabled())) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // ignore
  }
}

/**
 * Double heavy impact (200 ms apart) — used on SOS sent to give a
 * strong "double tap" confirmation.
 */
export async function hapticSOSSent(): Promise<void> {
  if (!(await isHapticEnabled())) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    // ignore
  }
}
