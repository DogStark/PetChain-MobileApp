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

// ─── SOS countdown haptics (#1387) ───────────────────────────────────────────

type SilentModeProvider = () => boolean | Promise<boolean>;

let silentModeProvider: SilentModeProvider = () => false;

/**
 * Register how the app detects that the device is in silent mode (ringer
 * off). SOS haptics are skipped while this returns true.
 */
export function setSilentModeProvider(provider: SilentModeProvider): void {
  silentModeProvider = provider;
}

/** True when the device reports silent mode. Errors are treated as not silent. */
export async function isSilentMode(): Promise<boolean> {
  try {
    return await silentModeProvider();
  } catch {
    return false;
  }
}

async function canPlaySOSHaptic(): Promise<boolean> {
  if (!(await isHapticEnabled())) return false;
  return !(await isSilentMode());
}

/** Light impact for each second of the SOS countdown. */
export async function hapticSOSCountdownTick(): Promise<void> {
  if (!(await canPlaySOSHaptic())) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // ignore
  }
}

/** Notification-success haptic when the SOS countdown is cancelled. */
export async function hapticSOSCancelled(): Promise<void> {
  if (!(await canPlaySOSHaptic())) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // ignore
  }
}

/** Heavy impact when SOS fires at the end of the countdown. */
export async function hapticSOSFired(): Promise<void> {
  if (!(await canPlaySOSHaptic())) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    // ignore
  }
}
