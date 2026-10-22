/**
 * Notification privacy levels for health data.
 *
 * Health notifications can leak pet names, medication names, dosages, or
 * medical details onto a locked device that is shared with other people.
 * Users pick one of three modes and every notification surface (local
 * notifications, remote APNs/FCM payloads, and notification-action payloads)
 * must honor the selected mode.
 *
 * Default: {@link NotificationPrivacyLevel.MINIMAL} — the documented default
 * keeps lock-screen content free of sensitive health data unless the user
 * explicitly opts into full content.
 */

export enum NotificationPrivacyLevel {
  /** Full health content is shown, including names, medications and details. */
  FULL = 'full',
  /** Lock-screen safe: no diagnosis, medication, dosage or location data. */
  MINIMAL = 'minimal',
  /** No health content at all; only a generic "you have a notification". */
  SILENT = 'silent',
}

/** Documented default privacy level for health notifications. */
export const DEFAULT_NOTIFICATION_PRIVACY_LEVEL = NotificationPrivacyLevel.MINIMAL;

/** Keys that must never appear in a minimal/silent lock-screen payload. */
export const SENSITIVE_NOTIFICATION_KEYS = [
  'diagnosis',
  'condition',
  'medication',
  'medicationName',
  'dosage',
  'dose',
  'prescription',
  'treatment',
  'symptoms',
  'notes',
  'location',
  'latitude',
  'longitude',
  'address',
  'petName',
  'patientName',
] as const;

/** Generic, non-sensitive copy used when content is redacted. */
export const REDACTED_NOTIFICATION_TITLE = 'Health reminder';
exnexport const REDACTED_NOTIFICATION_BODY = 'Open the app to view details.';

/**
 * A health notification before redaction. `data` carries the structured
 * payload that would be delivered to APNs/FCM and to notification actions.
 */
export interface HealthNotificationContent {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * A notification-action descriptor. Actions must keep working in every mode
 * without embedding sensitive health data in the payload.
 */
export interface NotificationAction {
  identifier: string;
  title: string;
  /** Optional non-sensitive payload; sensitive keys are stripped. */
  data?: Record<string, unknown>;
}

/**
 * Normalize an unknown value into a valid privacy level, falling back to the
 * documented default so corrupted or missing preferences are safe.
 */
export function normalizeNotificationPrivacyLevel(
  value: unknown,
): NotificationPrivacyLevel {
  if (
    value === NotificationPrivacyLevel.FULL ||
    value === NotificationPrivacyLevel.MINIMAL ||
    value === NotificationPrivacyLevel.SILENT
  ) {
    return value;
  }
  return DEFAULT_NOTIFICATION_PRIVACY_LEVEL;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_NOTIFICATION_KEYS.some(
    (sensitive) => normalized === sensitive.toLowerCase(),
  );
}

/**
 * Remove sensitive keys from a payload. Used for minimal and silent modes so
 * lock-screen payloads contain no diagnosis, medication, or location data.
 */
export function stripSensitiveData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data) {
    return undefined;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      continue;
    }
    redacted[key] = value;
  }
  return Object.keys(redacted).length > 0 ? redacted : undefined;
}

/**
 * Apply the selected privacy level to a health notification.
 *
 * - FULL: content is passed through unchanged.
 * - MINIMAL: title/body are replaced with generic copy and sensitive keys are
 *   stripped from the payload.
 * - SILENT: no health content is delivered; only a generic marker remains.
 */
export function redactNotificationContent(
  content: HealthNotificationContent,
  level: NotificationPrivacyLevel = DEFAULT_NOTIFICATION_PRIVACY_LEVEL,
): HealthNotificationContent {
  switch (level) {
    case NotificationPrivacyLevel.FULL:
      return { ...content };
    case NotificationPrivacyLevel.SILENT:
      return {
        title: REDACTED_NOTIFICATION_TITLE,
        body: REDACTED_NOTIFICATION_BODY,
        data: undefined,
      };
    case NotificationPrivacyLevel.MINIMAL:
    default:
      return {
        title: REDACTED_NOTIFICATION_TITLE,
        body: REDACTED_NOTIFICATION_BODY,
        data: stripSensitiveData(content.data),
      };
  }
}

/**
 * Build the remote (APNs/FCM) payload for a health notification, honoring the
 * selected privacy level. Sensitive keys are stripped in minimal/silent modes
 * so lock-screen payloads never carry diagnosis, medication, or location data.
 */
export function buildRemoteNotificationPayload(
  content: HealthNotificationContent,
  level: NotificationPrivacyLevel = DEFAULT_NOTIFICATION_PRIVACY_LEVEL,
): Record<string, unknown> {
  const redacted = redactNotificationContent(content, level);
  const payload: Record<string, unknown> = {
    title: redacted.title,
    body: redacted.body,
  };
  if (redacted.data) {
    payload.data = redacted.data;
  }
  return payload;
}

/**
 * Build the local notification content for a health notification, honoring the
 * selected privacy level.
 */
export function buildLocalNotificationContent(
  content: HealthNotificationContent,
  level: NotificationPrivacyLevel = DEFAULT_NOTIFICATION_PRIVACY_LEVEL,
): HealthNotificationContent {
  return redactNotificationContent(content, level);
}

/**
 * Redact notification actions so they keep working in every mode without
 * embedding sensitive health data in the payload. Action identifiers and
 * titles are preserved so the actions remain functional.
 */
export function redactNotificationActions(
  actions: NotificationAction[],
  level: NotificationPrivacyLevel = DEFAULT_NOTIFICATION_PRIVACY_LEVEL,
): NotificationAction[] {
  if (level === NotificationPrivacyLevel.FULL) {
    return actions.map((action) => ({ ...action }));
  }
  return actions.map((action) => ({
    identifier: action.identifier,
    title: action.title,
    data: stripSensitiveData(action.data),
  }));
}
