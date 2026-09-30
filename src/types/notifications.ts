/**
 * Notification privacy levels for health data.
 *
 * Health notifications can leak pet names, medication names, or medical
 * details onto a locked device that may be shared with other people. The
 * selected level controls how much sensitive content is placed into local
 * notifications, remote (APNs/FCM) payloads, and notification-action
 * payloads.
 *
 * - `full`:    Full health content is shown (default).
 * - `minimal`: Generic content only; no diagnosis, medication, or location
 *              data is included in lock-screen payloads.
 * - `silent`:  No visible content; the notification is delivered silently.
 */
export type NotificationPrivacyLevel = 'full' | 'minimal' | 'silent';

/**
 * Documented default. `full` preserves existing behavior for users who have
 * not yet chosen a privacy level.
 */
export const DEFAULT_NOTIFICATION_PRIVACY_LEVEL: NotificationPrivacyLevel = 'full';

/**
 * Fields that must never appear in a lock-screen payload when the privacy
 * level is `minimal` or `silent`.
 */
export const SENSITIVE_NOTIFICATION_FIELDS = [
  'diagnosis',
  'medication',
  'medicationName',
  'location',
  'petName',
] as const;

export type SensitiveNotificationField = (typeof SENSITIVE_NOTIFICATION_FIELDS)[number];

/**
 * Generic, non-sensitive copy used when redacting notification content.
 */
export const REDACTED_NOTIFICATION_CONTENT = {
  title: 'Health reminder',
  body: 'You have a health reminder. Open the app for details.',
} as const;

/**
 * A notification action that remains functional without embedding sensitive
 * data in the payload. Actions reference the notification by id and are
 * resolved inside the app after authentication.
 */
export interface NotificationAction {
  /** Stable identifier used to resolve the action in-app. */
  id: string;
  /** Localized label shown on the action button. */
  title: string;
  /** Identifier of the notification this action belongs to. */
  notificationId: string;
}

/**
 * Shape of the content that may be placed into a local notification or a
 * remote (APNs/FCM) payload. Sensitive fields are optional and are stripped
 * according to the active privacy level.
 */
export interface HealthNotificationPayload {
  /** Identifier used to resolve full details in-app. */
  notificationId: string;
  /** Privacy level applied when this payload was produced. */
  privacyLevel: NotificationPrivacyLevel;
  /** Visible title. Redacted in `minimal`/`silent` modes. */
  title?: string;
  /** Visible body. Redacted in `minimal`/`silent` modes. */
  body?: string;
  /** Sensitive fields, omitted in `minimal`/`silent` modes. */
  diagnosis?: string;
  medication?: string;
  medicationName?: string;
  location?: string;
  petName?: string;
  /** Actions that work without sensitive payload data. */
  actions?: NotificationAction[];
}

/**
 * Returns true when the given privacy level must redact sensitive content
 * from lock-screen payloads.
 */
export function shouldRedactNotificationContent(
  level: NotificationPrivacyLevel,
): boolean {
  return level === 'minimal' || level === 'silent';
}

/**
 * Applies the privacy level to a health notification payload, stripping
 * sensitive fields and replacing visible content when required. The
 * notification id and actions are preserved so actions keep working without
 * sensitive data in the payload.
 */
export function applyNotificationPrivacy(
  payload: HealthNotificationPayload,
  level: NotificationPrivacyLevel = DEFAULT_NOTIFICATION_PRIVACY_LEVEL,
): HealthNotificationPayload {
  const redacted: HealthNotificationPayload = {
    notificationId: payload.notificationId,
    privacyLevel: level,
    actions: payload.actions,
  };

  if (level === 'full') {
    return {
      ...payload,
      privacyLevel: level,
    };
  }

  if (level === 'minimal') {
    redacted.title = REDACTED_NOTIFICATION_CONTENT.title;
    redacted.body = REDACTED_NOTIFICATION_CONTENT.body;
    return redacted;
  }

  // silent: no visible content at all.
  return redacted;
}
