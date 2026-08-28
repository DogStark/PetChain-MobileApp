import { Linking, PermissionsAndroid, Platform } from 'react-native';

export interface AndroidPermissionRationale {
  title: string;
  message: string;
  buttonPositive?: string;
  buttonNegative?: string;
  buttonNeutral?: string;
}

export async function openSettingsSafely(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // Best effort only.
  }
}

export async function requestAndroidPermission(
  permission: string,
  rationale: AndroidPermissionRationale,
): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  const status = await PermissionsAndroid.request(
    permission as Parameters<typeof PermissionsAndroid.request>[0],
    {
      title: rationale.title,
      message: rationale.message,
      buttonPositive: rationale.buttonPositive ?? 'OK',
      buttonNegative: rationale.buttonNegative,
      buttonNeutral: rationale.buttonNeutral,
    },
  );
  if (status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    await openSettingsSafely();
    return false;
  }

  return status === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Requests foreground-only location permission (least privilege).
 *
 * - Android: requests ACCESS_COARSE_LOCATION (not FINE, not BACKGROUND).
 *   Opens Settings automatically on NEVER_ASK_AGAIN so the user can recover.
 * - iOS: no explicit request needed here; the system prompt fires on the first
 *   Geolocation call. Returns true so callers proceed uniformly.
 *
 * Never requests ACCESS_FINE_LOCATION or ACCESS_BACKGROUND_LOCATION.
 */
export async function requestForegroundLocationPermission(
  rationale: AndroidPermissionRationale,
): Promise<boolean> {
  if (Platform.OS !== 'android') {
    // iOS: permission is requested implicitly by Geolocation.getCurrentPosition.
    // NSLocationWhenInUseUsageDescription in Info.plist provides the purpose string.
    return true;
  }

  return requestAndroidPermission(
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    rationale,
  );
}
