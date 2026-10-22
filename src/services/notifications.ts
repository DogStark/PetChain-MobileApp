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
const QUIET_HOURS_STORAGE_KEY = '@pawtrack/notification_quiet_hours';
const QUIET_HOURS_DEFERRAL_STORAGE_KEY = '@pawtrack/notification_quiet_hours_deferral';

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

/**
 * Per-account quiet hours configuration.
 *
 * - `enabled`      : whether quiet hours are active.
 * - `startMinutes` : minutes after local midnight when quiet hours begin (0-1439).
 * - `endMinutes`   : minutes after local midnight when quiet hours end (0-1439).
 *                    May be less than `startMinutes` for windows crossing midnight.
 * - `timezoneOffsetMinutes` : the offset (in minutes, as returned by
 *                    `Date#getTimezoneOffset`) the config was last evaluated in.
 *                    Used to detect timezone changes so the next eligible
 *                    delivery time is recomputed.
 */
export interface QuietHoursConfig {
  enabled: boolean;
  startMinutes: number;
  endMinutes: number;
  timezoneOffsetMinutes?: number;
}

export const DEFAULT_QUIET_HOURS_CONFIG: QuietHoursConfig = {
  enabled: false,
  startMinutes: 22 * 60,
  endMinutes: 7 * 60,
};

const MINUTES_PER_DAY = 24 * 60;

function isValidMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < MINUTES_PER_DAY
  );
}

function isQuietHoursConfig(value: unknown): value is QuietHoursConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.enabled === 'boolean' &&
    isValidMinutes(candidate.startMinutes) &&
    isValidMinutes(candidate.endMinutes) &&
    (candidate.timezoneOffsetMinutes === undefined ||
      typeof candidate.timezoneOffsetMinutes === 'number')
  );
}

/**
 * Result of evaluating a reminder against the quiet hours window.
 *
 * - `deferred`            : true when the reminder falls inside quiet hours.
 * - `nextEligibleAt`      : timestamp (ms) when delivery becomes eligible. When
 *                           not deferred this equals the reminder timestamp.
 * - `timezoneChanged`     : true when the supplied offset differs from the one
 *                           stored on the config, meaning the window was
 *                           recomputed for a new timezone.
 */
export interface QuietHoursEvaluation {
  deferred: boolean;
  nextEligibleAt: number;
  timezoneChanged: boolean;
}

/**
 * Convert a timestamp to minutes-after-local-midnight for the given timezone
 * offset (minutes as returned by `Date#getTimezoneOffset`).
 */
function toLocalMinutes(timestamp: number, timezoneOffsetMinutes: number): number {
  const localMs = timestamp - timezoneOffsetMinutes * 60 * 1000;
  const minutes = Math.floor(localMs / (60 * 1000)) % MINUTES_PER_DAY;
  return minutes < 0 ? minutes + MINUTES_PER_DAY : minutes;
}

/**
 * Compute the timestamp at which the quiet window ends on the local day that
 * contains `timestamp`, accounting for windows that cross midnight.
 */
function computeWindowEnd(
  timestamp: number,
  config: QuietHoursConfig,
  timezoneOffsetMinutes: number,
): number {
  const localMinutes = toLocalMinutes(timestamp, timezoneOffsetMinutes);
  const crossesMidnight = config.endMinutes <= config.startMinutes;

  let minutesUntilEnd: number;
  if (crossesMidnight) {
    // Window spans midnight: if we are before the end (early morning) the end
    // is later today; otherwise it is tomorrow.
    minutesUntilEnd =
      localMinutes < config.endMinutes
        ? config.endMinutes - localMinutes
        : MINUTES_PER_DAY - localMinutes + config.endMinutes;
  } else {
    minutesUntilEnd = config.endMinutes - localMinutes;
  }

  return timestamp + minutesUntilEnd * 60 * 1000;
}

/**
 * Determine whether a reminder timestamp falls inside the configured quiet
 * hours and, if so, when it becomes eligible for delivery.
 *
 * Handles windows that cross midnight and recomputes correctly when the
 * timezone offset differs from the one stored on the config.
 */
export function evaluateQuietHours(
  config: QuietHoursConfig,
  reminderAt: number,
  timezoneOffsetMinutes: number,
): QuietHoursEvaluation {
  const timezoneChanged =
    config.timezoneOffsetMinutes !== undefined &&
    config.timezoneOffsetMinutes !== timezoneOffsetMinutes;

  if (!config.enabled) {
    return { deferred: false, nextEligibleAt: reminderAt, timezoneChanged };
  }

  const localMinutes = toLocalMinutes(reminderAt, timezoneOffsetMinutes);
  const { startMinutes, endMinutes } = config;
  const crossesMidnight = endMinutes <= startMinutes;

  const inWindow = crossesMidnight
    ? localMinutes >= startMinutes || localMinutes < endMinutes
    : localMinutes >= startMinutes && localMinutes < endMinutes;

  if (!inWindow) {
    return { deferred: false, nextEligibleAt: reminderAt, timezoneChanged };
  }

  return {
    deferred: true,
    nextEligibleAt: computeWindowEnd(reminderAt, config, timezoneOffsetMinutes),
    timezoneChanged,
  };
}

/**
 * Persisted record of the most recent deferral so the UI can explain why a
 * reminder was not delivered and when it will be. Survives offline restarts.
 */
export interface QuietHoursDeferralState {
  reminderAt: number;
  nextEligibleAt: number;
  evaluatedAt: number;
  timezoneOffsetMinutes: number;
}

function isDeferralState(value: unknown): value is QuietHoursDeferralState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.reminderAt === 'number' &&
    typeof candidate.nextEligibleAt === 'number' &&
    typeof candidate.evaluatedAt === 'number' &&
    typeof candidate.timezoneOffsetMinutes === 'number'
  );
}

/**
 * Read the cached quiet hours config. Falls back to the documented default
 * when unset or corrupted so offline behavior is preserved.
 */
export async function getQuietHoursConfig(): Promise<QuietHoursConfig> {
  try {
    const stored = await AsyncStorage.getItem(QUIET_HOURS_STORAGE_KEY);
    if (!stored) {
      return DEFAULT_QUIET_HOURS_CONFIG;
    }
    const parsed: unknown = JSON.parse(stored);
    return isQuietHoursConfig(parsed) ? parsed : DEFAULT_QUIET_HOURS_CONFIG;
  } catch {
    return DEFAULT_QUIET_HOURS_CONFIG;
  }
}

/**
 * Persist the quiet hours config. Invalid values are rejected so a bad write
 * cannot silently disable quiet hours.
 */
export async function setQuietHoursConfig(config: QuietHoursConfig): Promise<void> {
  if (!isQuietHoursConfig(config)) {
    throw new Error('Invalid quiet hours config');
  }
  await AsyncStorage.setItem(QUIET_HOURS_STORAGE_KEY, JSON.stringify(config));
}

/**
 * Read the last persisted deferral state, or null when none is cached.
 */
export async function getQuietHoursDeferralState(): Promise<QuietHoursDeferralState | null> {
  try {
    const stored = await AsyncStorage.getItem(QUIET_HOURS_DEFERRAL_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const parsed: unknown = JSON.parse(stored);
    return isDeferralState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist the last deferral state so the UI can explain deferred notifications
 * after an offline restart.
 */
export async function setQuietHoursDeferralState(
  state: QuietHoursDeferralState | null,
): Promise<void> {
  if (state === null) {
    await AsyncStorage.removeItem(QUIET_HOURS_DEFERRAL_STORAGE_KEY);
    return;
  }
  if (!isDeferralState(state)) {
    throw new Error('Invalid quiet hours deferral state');
  }
  await AsyncStorage.setItem(QUIET_HOURS_DEFERRAL_STORAGE_KEY, JSON.stringify(state));
}
