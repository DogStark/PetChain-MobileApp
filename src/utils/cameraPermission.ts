/**
 * Camera permission state resolution — Issue #936
 *
 * The OS surfaces several distinct camera-permission states that each need a
 * different recovery path: undetermined, granted, denied-but-recoverable,
 * denied-permanently, restricted, and unavailable. This module maps the raw
 * Expo camera permission snapshot into a single, testable enum that the
 * QRScannerScreen can render against.
 */

export type CameraPermissionState =
  | 'granted'
  | 'undetermined'
  | 'denied'
  | 'denied-permanently'
  | 'restricted'
  | 'unavailable';

export interface CameraPermissionSnapshot {
  /** Expo permission status ('granted' | 'denied' | 'undetermined'). */
  status?: string | null;
  granted?: boolean | null;
  /** False when the user has permanently declined (iOS) / disabled the toggle. */
  canAskAgain?: boolean | null;
}

/**
 * Resolve a camera permission snapshot into a stable state enum.
 *
 * Ordering matters:
 *  - A granted snapshot wins regardless of other fields.
 *  - "undetermined" means the user has not decided yet → prompt them.
 *  - "unavailable" means the device cannot provide camera access at all.
 *  - "restricted" (parental/device management controls) requires settings.
 *  - A denied snapshot where `canAskAgain === false` is permanently denied.
 */
export const resolveCameraPermissionState = (
  permission: CameraPermissionSnapshot | null | undefined,
): CameraPermissionState => {
  if (!permission) return 'unavailable';

  if (permission.granted === true || permission.status === 'granted') {
    return 'granted';
  }

  const status = permission.status;

  if (status === 'undetermined') return 'undetermined';

  if (status === 'unavailable') return 'unavailable';

  if (status === 'restricted') return 'restricted';

  // 'denied' (or a non-granted status). Once the user picks "don't ask again"
  // the OS will not present the system prompt again — only settings can help.
  if (permission.canAskAgain === false) return 'denied-permanently';

  return 'denied';
};

/** True when the only recovery is the system settings screen (can't re-prompt). */
export const cameraPermissionRequiresSettings = (state: CameraPermissionState): boolean =>
  state === 'denied-permanently' || state === 'restricted';

/** True when the camera preview may be shown. */
export const cameraPermissionAllowsCamera = (state: CameraPermissionState): boolean =>
  state === 'granted';
