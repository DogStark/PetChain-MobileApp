/**
 * Permission Utility Helpers — Issue #813
 *
 * Unified interface to check and request device permissions (camera,
 * location, notifications, calendar) on both iOS and Android.
 *
 * Uses the Expo permission modules already present in package.json:
 *   - expo-camera        → camera
 *   - expo-location      → location
 *   - expo-notifications → notifications
 *   - expo-calendar      → calendar (imported on demand: the native module is
 *     optional, and only appointment export needs it)
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
  /** Device calendar, used by appointment export (issue #1186). */
  CALENDAR = 'CALENDAR',
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

    case PermissionType.CALENDAR: {
      // Dynamic import keeps expo-calendar optional for callers that never
      // touch the calendar flow, and for the Jest suites that map it to a mock.
      const Calendar = await import('expo-calendar');
      const { status } = await Calendar.getCalendarPermissionsAsync();
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

    case PermissionType.CALENDAR: {
      const Calendar = await import('expo-calendar');
      const { status } = await Calendar.requestCalendarPermissionsAsync();
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

// ─────────────────────────────────────────────────────────────────────────────
// Server-confirmed notification permission (Issue #1146 — quiet hours)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Server-confirmed notification settings for the signed-in account.
 *
 * `confirmed` is only `true` once the server has acknowledged the account's
 * notification preferences (e.g. after a successful settings sync). Until
 * then the quiet-hours UI must not assume reminders will be delivered.
 */
export interface ServerNotificationSettings {
  /** Whether the server has confirmed the account's notification settings. */
  confirmed: boolean;
  /** Server-side master switch for care reminders. */
  remindersEnabled?: boolean;
  /** Server-side quiet-hours configuration, if any. */
  quietHours?: {
    enabled: boolean;
    /** Minutes since local midnight (0–1439). */
    startMinutes: number;
    /** Minutes since local midnight (0–1439). */
    endMinutes: number;
    /** IANA timezone the quiet hours were configured in. */
    timezone?: string;
  } | null;
}

/**
 * Combined notification permission state used by the quiet-hours UI.
 *
 * - `osStatus`      — raw OS permission status (never throws)
 * - `serverConfirmed` — whether the server confirmed the account settings
 * - `canDeliver`    — `true` only when the OS grants notifications AND the
 *                     server has confirmed reminders are enabled
 * - `reason`        — machine-readable explanation for the UI when delivery
 *                     is not possible (denied / restricted / undetermined /
 *                     server-unconfirmed / reminders-disabled)
 */
export type NotificationDeliveryState =
  | 'deliverable'
  | 'os-denied'
  | 'os-restricted'
  | 'os-undetermined'
  | 'server-unconfirmed'
  | 'reminders-disabled';

export interface NotificationPermissionResult {
  osStatus: PermissionStatus;
  serverConfirmed: boolean;
  canDeliver: boolean;
  reason: NotificationDeliveryState;
}

/**
 * Checks the OS notification permission and combines it with the
 * server-confirmed account notification settings.
 *
 * Never throws: if the OS check fails (e.g. module unavailable) the status is
 * treated as `undetermined` so the UI can still render an explanation.
 *
 * @param serverSettings - Server-confirmed settings, or `null`/`undefined`
 *                         when they have not been fetched yet.
 */
export async function getNotificationPermissionState(
  serverSettings?: ServerNotificationSettings | null,
): Promise<NotificationPermissionResult> {
  let osStatus: PermissionStatus = 'undetermined';
  try {
    osStatus = await checkPermission(PermissionType.NOTIFICATIONS);
  } catch {
    osStatus = 'undetermined';
  }

  const serverConfirmed = serverSettings?.confirmed === true;

  let reason: NotificationDeliveryState;
  if (osStatus === 'denied') {
    reason = 'os-denied';
  } else if (osStatus === 'restricted') {
    reason = 'os-restricted';
  } else if (osStatus !== 'granted') {
    reason = 'os-undetermined';
  } else if (!serverConfirmed) {
    reason = 'server-unconfirmed';
  } else if (serverSettings?.remindersEnabled === false) {
    reason = 'reminders-disabled';
  } else {
    reason = 'deliverable';
  }

  return {
    osStatus,
    serverConfirmed,
    canDeliver: reason === 'deliverable',
    reason,
  };
}

/**
 * Human-readable explanation for a non-deliverable notification state.
 * Returns `null` when reminders can be delivered.
 */
export function describeNotificationDeliveryState(
  reason: NotificationDeliveryState,
): string | null {
  switch (reason) {
    case 'deliverable':
      return null;
    case 'os-denied':
      return 'Notifications are turned off for PetChain. Care reminders will not be delivered until you enable notifications in Settings.';
    case 'os-restricted':
      return 'Notifications are restricted on this device. Care reminders will not be delivered until the restriction is lifted.';
    case 'os-undetermined':
      return 'Notifications have not been enabled yet. Care reminders will not be delivered until you allow notifications.';
    case 'server-unconfirmed':
      return 'Your notification settings have not been confirmed by the server yet. Care reminders may be delayed.';
    case 'reminders-disabled':
      return 'Care reminders are turned off in your account settings.';
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-confirmed calendar export permission (Issue #1186)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Server-confirmed availability for exporting appointments to the device
 * calendar, taken from the feature-availability snapshot (the same mechanism
 * #1146 uses for notification settings). `confirmed` is only `true` once the
 * server has acknowledged that this account may export.
 */
export interface ServerCalendarExportSettings {
  /** Whether the server has confirmed calendar export for this account. */
  confirmed: boolean;
  /** Server-side status, when known. `maintenance` is retryable, `disabled` is not. */
  status?: 'enabled' | 'disabled' | 'maintenance';
}

/**
 * Why an export can or cannot run right now.
 *
 * The OS states and the server states are deliberately separate so the UI can
 * point at the right fix: a denial needs Settings, an unconfirmed account needs
 * a connection, and neither is presented as an empty list.
 */
export type CalendarExportState =
  | 'available'
  | 'os-denied'
  | 'os-restricted'
  | 'os-undetermined'
  | 'server-unconfirmed'
  | 'server-maintenance';

export interface CalendarExportPermissionResult {
  osStatus: PermissionStatus;
  serverConfirmed: boolean;
  canExport: boolean;
  reason: CalendarExportState;
}

/**
 * Combines the OS calendar permission with the server-confirmed availability.
 *
 * Never throws: an unavailable native module reads as `undetermined`, so the UI
 * still renders an explanation instead of crashing the appointments screen.
 *
 * @param serverSettings - Server-confirmed availability, or `null`/`undefined`
 *                         when it has not been fetched yet.
 */
export async function getCalendarExportPermissionState(
  serverSettings?: ServerCalendarExportSettings | null,
): Promise<CalendarExportPermissionResult> {
  let osStatus: PermissionStatus = 'undetermined';
  try {
    osStatus = await checkPermission(PermissionType.CALENDAR);
  } catch {
    osStatus = 'undetermined';
  }

  const serverConfirmed = serverSettings?.confirmed === true;

  let reason: CalendarExportState;
  if (osStatus === 'denied') {
    reason = 'os-denied';
  } else if (osStatus === 'restricted') {
    reason = 'os-restricted';
  } else if (osStatus !== 'granted') {
    reason = 'os-undetermined';
  } else if (!serverConfirmed) {
    reason =
      serverSettings?.status === 'maintenance' ? 'server-maintenance' : 'server-unconfirmed';
  } else {
    reason = 'available';
  }

  return {
    osStatus,
    serverConfirmed,
    canExport: reason === 'available',
    reason,
  };
}

/**
 * Human-readable explanation for a non-exportable calendar state.
 * Returns `null` when an export can run.
 */
export function describeCalendarExportState(reason: CalendarExportState): string | null {
  switch (reason) {
    case 'available':
      return null;
    case 'os-denied':
      return 'Calendar access is turned off for PetChain. Appointments cannot be exported until you allow calendar access in Settings.';
    case 'os-restricted':
      return 'Calendar access is restricted on this device, so appointments cannot be exported. Contact your device administrator to lift the restriction.';
    case 'os-undetermined':
      return 'PetChain has not been allowed to access your calendar yet. Allow access to export appointments.';
    case 'server-unconfirmed':
      return 'Your account has not confirmed calendar export yet. Connect to the internet so we can check, then try again.';
    case 'server-maintenance':
      return 'Calendar export is temporarily unavailable while we make improvements. Please check back shortly.';
    default:
      return null;
  }
}
