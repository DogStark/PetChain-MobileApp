/**
 * Permission Utility Helpers — Issue #813
 *
 * Unified interface to check and request device permissions (camera,
 * location, notifications) on both iOS and Android.
 *
 * Uses the Expo permission modules already present in package.json:
 *   - expo-camera        → camera
 *   - expo-location      → location
 *   - expo-notifications → notifications
 *
 * The `PermissionStatus` type mirrors the Expo permission result so callers
 * get a consistent shape regardless of which permission was requested.
 */

import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

// ─────────────────────────────────────────────────────────────────────────────
// PermissionType enum
// ─────────────────────────────────────────────────────────────────────────────

export enum PermissionType {
  CAMERA = 'CAMERA',
  LOCATION = 'LOCATION',
  NOTIFICATIONS = 'NOTIFICATIONS',
}

// ─────────────────────────────────────────────────────────────────────────────
// PermissionStatus type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalised permission status returned by both checkPermission and
 * requestPermission.
 *
 * - `granted`          — user has granted the permission
 * - `denied`           — user explicitly denied (may be permanent on iOS)
 * - `undetermined`     — not yet requested
 * - `restricted`       — system-level restriction (iOS parental controls etc.)
 * - `limited`          — partial access (e.g. limited photo library on iOS 14+)
 */
export type PermissionStatus =
  | 'granted'
  | 'denied'
  | 'undetermined'
  | 'restricted'
  | 'limited';

// Internal helper to map Expo's PermissionStatus union → our PermissionStatus
function mapStatus(status: string): PermissionStatus {
  switch (status) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'restricted':
      return 'restricted';
    case 'limited':
      return 'limited';
    default:
      return 'undetermined';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// checkPermission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the current permission status for the requested type **without**
 * triggering a system prompt.
 *
 * @param type - One of `PermissionType.CAMERA | LOCATION | NOTIFICATIONS`
 * @returns    - The current `PermissionStatus`
 */
export async function checkPermission(type: PermissionType): Promise<PermissionStatus> {
  switch (type) {
    case PermissionType.CAMERA: {
      const { status } = await Camera.getCameraPermissionsAsync();
      return mapStatus(status);
    }

    case PermissionType.LOCATION: {
      const { status } = await Location.getForegroundPermissionsAsync();
      return mapStatus(status);
    }

    case PermissionType.NOTIFICATIONS: {
      const { status } = await Notifications.getPermissionsAsync();
      return mapStatus(status);
    }

    default: {
      // Exhaustive check — TypeScript will surface this if a new enum value
      // is added without updating this switch.
      const _exhaustive: never = type;
      throw new Error(`checkPermission: unknown PermissionType "${_exhaustive as string}"`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// requestPermission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Requests the given permission, potentially showing a system prompt.
 *
 * On iOS, once a permission has been denied the system will not show the
 * prompt again; `denied` will be returned immediately. Direct the user to
 * Settings in that case (see `permissionRationale.ts`).
 *
 * @param type - One of `PermissionType.CAMERA | LOCATION | NOTIFICATIONS`
 * @returns    - The resulting `PermissionStatus` after the request
 */
export async function requestPermission(type: PermissionType): Promise<PermissionStatus> {
  switch (type) {
    case PermissionType.CAMERA: {
      const { status } = await Camera.requestCameraPermissionsAsync();
      return mapStatus(status);
    }

    case PermissionType.LOCATION: {
      const { status } = await Location.requestForegroundPermissionsAsync();
      return mapStatus(status);
    }

    case PermissionType.NOTIFICATIONS: {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      return mapStatus(status);
    }

    default: {
      const _exhaustive: never = type;
      throw new Error(`requestPermission: unknown PermissionType "${_exhaustive as string}"`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns `true` when the permission is currently granted.
 *
 * Equivalent to `(await checkPermission(type)) === 'granted'` but slightly
 * more readable at call sites.
 */
export async function hasPermission(type: PermissionType): Promise<boolean> {
  return (await checkPermission(type)) === 'granted';
}
