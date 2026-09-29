import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Notification privacy levels for health data.
 *
 * - `full`    : show pet names, medication names, and medical details.
 * - `minimal` : show a generic health reminder with no diagnosis, medication,
 *               or location data (safe for lock screens).
 * - `silent`  : show no health content at all; only a neutral indicator.
 *
 * Default is `minimal` so that a fresh install never leaks health data on a
 * locked device shared with other people.
 */
export type NotificationPrivacyLevel = 'full' | 'minimal' | 'silent';

export const DEFAULT_NOTIFICATION_PRIVACY_LEVEL: NotificationPrivacyLevel = 'minimal';

const PRIVACY_STORAGE_KEY = '@pawtrack/notification_privacy_level';

const VALID_LEVELS: NotificationPrivacyLevel[] = ['full', 'minimal', 'silent'];

function isPrivacyLevel(value: unknown): value is NotificationPrivacyLevel {
  return typeof value === 'string' && (VALID_LEVELS as string[]).includes(value);
}

/**
 * Health notification content that may contain sensitive fields. Callers pass
 * the richest content they have; redaction is applied per selected mode.
 */
export interface HealthNotificationContent {
  /** e.g. pet name */
  title: string;
  /** e.g. "Give 5mg Apoquel for skin allergy" */
  body: string;
  /** Optional diagnosis / condition text. */
  diagnosis?: string;
  /** Optional medication name. */
  medication?: string;
  /** Optional location (clinic, address, coordinates). */
  location?: string;
  /** Arbitrary structured data attached to the notification. */
  data?: Record<string, unknown>;
}

/**
 * Redacted payload shape. In `minimal` and `silent` modes sensitive fields are
 * omitted entirely rather than blanked, so they never reach APNs/FCM or the
 * lock screen.
 */
export interface RedactedNotificationPayload {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

const GENERIC_TITLE = 'Health reminder';
const GENERIC_BODY = 'You have a health reminder. Open the app to view details.';
const SILENT_TITLE = 'PawTrack';
const SILENT_BODY = 'Open the app for updates.';

/**
 * Strip sensitive keys from arbitrary notification data. Used for every mode
 * except `full` so that action payloads never carry health details.
 */
function redactData(data?: Record<string, unknown>): Record<string, unknown> {
  if (!data) {
    return {};
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('diagnos') ||
      lower.includes('medication') ||
      lower.includes('med') ||
      lower.includes('location') ||
      lower.includes('address') ||
      lower.includes('lat') ||
      lower.includes('lng') ||
      lower.includes('condition') ||
      lower.includes('symptom')
    ) {
      continue;
    }
    redacted[key] = value;
  }
  return redacted;
}

/**
 * Apply the selected privacy level to health notification content.
 *
 * The returned payload is safe to hand to local notifications, APNs, and FCM.
 * Notification actions are preserved via `data.action` (a non-sensitive
 * identifier) so taps still route correctly without embedding health data.
 */
export function redactHealthNotification(
  content: HealthNotificationContent,
  level: NotificationPrivacyLevel,
): RedactedNotificationPayload {
  const action = typeof content.data?.action === 'string' ? content.data.action : undefined;

  if (level === 'full') {
    return {
      title: content.title,
      body: content.body,
      data: {
        ...(content.data ?? {}),
        ...(content.diagnosis ? { diagnosis: content.diagnosis } : {}),
        ...(content.medication ? { medication: content.medication } : {}),
        ...(content.location ? { location: content.location } : {}),
      },
    };
  }

  if (level === 'silent') {
    return {
      title: SILENT_TITLE,
      body: SILENT_BODY,
      data: action ? { action } : {},
    };
  }

  // minimal: generic copy, no diagnosis/medication/location anywhere.
  return {
    title: GENERIC_TITLE,
    body: GENERIC_BODY,
    data: action ? { action } : {},
  };
}

/**
 * Build the platform-specific remote payload (APNs for iOS, FCM for Android)
 * for a health notification, honoring the selected privacy level.
 */
export function buildRemoteHealthPayload(
  content: HealthNotificationContent,
  level: NotificationPrivacyLevel,
): Record<string, unknown> {
  const redacted = redactHealthNotification(content, level);

  if (Platform.OS === 'ios') {
    return {
      aps: {
        alert: { title: redacted.title, body: redacted.body },
        sound: level === 'silent' ? undefined : 'default',
      },
      ...redacted.data,
    };
  }

  return {
    notification: {
      title: redacted.title,
      body: redacted.body,
      sound: level === 'silent' ? undefined : 'default',
    },
    data: redacted.data,
  };
}

/**
 * Build the local notification content for a health notification, honoring the
 * selected privacy level. Mirrors the remote payload so lock-screen content is
 * consistent across delivery paths.
 */
export function buildLocalHealthNotification(
  content: HealthNotificationContent,
  level: NotificationPrivacyLevel,
): { title: string; body: string; data: Record<string, unknown> } {
  const redacted = redactHealthNotification(content, level);
  return {
    title: redacted.title,
    body: redacted.body,
    data: redacted.data,
  };
}

/**
 * Read the persisted privacy level. Falls back to the documented default when
 * unset or corrupted.
 */
export async function getNotificationPrivacyLevel(): Promise<NotificationPrivacyLevel> {
  try {
    const stored = await AsyncStorage.getItem(PRIVACY_STORAGE_KEY);
    return isPrivacyLevel(stored) ? stored : DEFAULT_NOTIFICATION_PRIVACY_LEVEL;
  } catch {
    return DEFAULT_NOTIFICATION_PRIVACY_LEVEL;
  }
}

/**
 * Persist the privacy level. Invalid values are rejected so a bad write cannot
 * silently downgrade privacy.
 */
export async function setNotificationPrivacyLevel(
  level: NotificationPrivacyLevel,
): Promise<void> {
  if (!isPrivacyLevel(level)) {
    throw new Error(`Invalid notification privacy level: ${String(level)}`);
  }
  await AsyncStorage.setItem(PRIVACY_STORAGE_KEY, level);
}
