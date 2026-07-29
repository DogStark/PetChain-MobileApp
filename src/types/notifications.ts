/**
 * Notification TypeScript types for PetChain Mobile App.
 *
 * Covers push notifications, local notifications, permission status,
 * and Android/iOS channel configuration.
 */

// ─── Permission Status ────────────────────────────────────────────────────────

/**
 * Notification permission status returned by the OS or expo-notifications.
 *
 * - `granted`    — user has allowed notifications
 * - `denied`     — user has explicitly denied notifications
 * - `undetermined` — user has not been asked yet
 */
export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

// ─── Push Notification Payload ────────────────────────────────────────────────

/**
 * Data payload delivered inside a remote (push) notification.
 * Mirrors the structure sent by the backend push service and decoded on device.
 */
export interface PushNotificationPayload {
  /** Opaque identifier for this notification instance. */
  notificationId: string;

  /**
   * Category used to route the notification to the correct handler and UI.
   * Matches `NotificationCategory` in notificationStore.ts.
   */
  category: 'medication' | 'appointment' | 'sos' | 'system';

  /** Short, human-readable heading shown in the notification tray. */
  title: string;

  /** Body copy shown below the title. */
  body: string;

  /**
   * Optional deep-link screen name and params.
   * Consumed by notificationNavigation.ts → resolveNavPayload.
   */
  screen?: string;
  screenParams?: Record<string, unknown>;

  /** Pet identifier the notification relates to, if any. */
  petId?: string;

  /** Medication identifier, if this is a medication reminder. */
  medicationId?: string;

  /** Appointment identifier, if this is an appointment reminder. */
  appointmentId?: string;

  /** Arbitrary extra fields forwarded from the server. */
  [key: string]: unknown;
}

// ─── Local Notification Options ───────────────────────────────────────────────

/**
 * Options used when scheduling a local notification via expo-notifications.
 */
export interface LocalNotificationOptions {
  /** Notification title displayed in the system tray. */
  title: string;

  /** Main body text of the notification. */
  body: string;

  /**
   * Optional subtitle (iOS only) shown between title and body.
   */
  subtitle?: string;

  /** Arbitrary data attached to the notification and available on tap. */
  data?: Record<string, unknown>;

  /**
   * ISO 8601 date-time string for when the notification should fire.
   * If omitted the notification is shown immediately.
   */
  scheduledTime?: string;

  /**
   * Number of seconds from now after which the notification fires.
   * Takes precedence over `scheduledTime` when both are provided.
   */
  secondsFromNow?: number;

  /**
   * Identifier of an Android notification channel.
   * Must match an `AndroidNotificationChannelConfig.channelId` registered at app start.
   */
  channelId?: string;

  /** Sound override for this notification. `true` = default system sound. */
  sound?: boolean | string;

  /** Notification category identifier used to attach action buttons. */
  categoryIdentifier?: string;

  /**
   * iOS badge count to apply when the notification is delivered.
   * Pass `0` to clear the badge.
   */
  badge?: number;

  /**
   * Android priority level.
   * @see https://developer.android.com/reference/android/app/NotificationManager
   */
  priority?: 'default' | 'high' | 'max' | 'low' | 'min';
}

// ─── Android Channel Configuration ───────────────────────────────────────────

/**
 * Android notification channel configuration.
 * Channels must be created before notifications can be posted on Android 8+.
 *
 * @see https://developer.android.com/training/notify-user/channels
 */
export interface AndroidNotificationChannelConfig {
  /** Unique channel identifier referenced by `LocalNotificationOptions.channelId`. */
  channelId: string;

  /** Human-readable name displayed in the system notification settings. */
  name: string;

  /** Optional extended description shown in system settings. */
  description?: string;

  /**
   * Importance level controls how intrusively the channel interrupts the user.
   *
   * - `max`     — heads-up notification + sound + vibration
   * - `high`    — sound + vibration; appears in status bar
   * - `default` — sound; no heads-up
   * - `low`     — no sound or vibration
   * - `min`     — silent; collapsed in shade
   */
  importance: 'max' | 'high' | 'default' | 'low' | 'min';

  /** Whether to play a sound when a notification is posted to this channel. */
  enableSound?: boolean;

  /**
   * Sound file name (without extension) from `android/app/src/main/res/raw/`.
   * Falls back to the default notification sound when not specified.
   */
  soundName?: string;

  /** Whether vibration is enabled for this channel. */
  enableVibration?: boolean;

  /**
   * Custom vibration pattern in milliseconds: [delay, on, off, on, off, …].
   * E.g. `[0, 250, 250, 250]` — wait 0 ms, vibrate 250 ms, pause 250 ms, vibrate 250 ms.
   */
  vibrationPattern?: number[];

  /** Whether to show a badge on the app icon when a notification is in this channel. */
  showBadge?: boolean;

  /** Whether the notification light (LED) is enabled. */
  enableLights?: boolean;

  /** Hex colour string for the notification LED (e.g. `'#4CAF50'`). */
  lightColor?: string;
}

// ─── Preset channel IDs ───────────────────────────────────────────────────────

/**
 * Well-known channel IDs used throughout the app.
 * Register each with `AndroidNotificationChannelConfig` at app startup.
 */
export const NOTIFICATION_CHANNEL_IDS = {
  MEDICATION_REMINDERS: 'medication_reminders',
  APPOINTMENT_REMINDERS: 'appointment_reminders',
  HEALTH_ALERTS: 'health_alerts',
  EMERGENCY_SOS: 'emergency_sos',
  GENERAL: 'general',
} as const;

export type NotificationChannelId =
  (typeof NOTIFICATION_CHANNEL_IDS)[keyof typeof NOTIFICATION_CHANNEL_IDS];
