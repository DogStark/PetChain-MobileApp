/**
 * Notification payload handling with schema versioning.
 *
 * Push payloads can outlive a mobile release, so every payload carries an
 * explicit schema version. Payloads are validated before use and mapped to the
 * current intent model via a compatibility parser. Unknown versions are
 * ignored safely and raw payloads are never logged.
 */

export const CURRENT_PAYLOAD_VERSION = 3;

export type NotificationIntent =
  | { type: 'openScreen'; screen: string; params?: Record<string, string> }
  | { type: 'openUrl'; url: string }
  | { type: 'none' };

export interface VersionedPayload {
  version: number;
  [key: string]: unknown;
}

export type ParseResult =
  | { status: 'ok'; intent: NotificationIntent }
  | { status: 'ignored'; reason: 'unknownVersion' | 'malformed' };

const SUPPORTED_VERSIONS = [1, 2, CURRENT_PAYLOAD_VERSION];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * v1 payloads used a flat `screen` field with no params.
 */
function parseV1(payload: Record<string, unknown>): NotificationIntent | undefined {
  const screen = asString(payload.screen);
  if (!screen) {
    return undefined;
  }
  return { type: 'openScreen', screen };
}

/**
 * v2 payloads nested the target under `data` and added optional params.
 */
function parseV2(payload: Record<string, unknown>): NotificationIntent | undefined {
  const data = payload.data;
  if (!isRecord(data)) {
    return undefined;
  }
  const screen = asString(data.screen);
  if (!screen) {
    return undefined;
  }
  return { type: 'openScreen', screen, params: asStringMap(data.params) };
}

/**
 * v3 (current) payloads use an explicit intent object.
 */
function parseV3(payload: Record<string, unknown>): NotificationIntent | undefined {
  const intent = payload.intent;
  if (!isRecord(intent)) {
    return undefined;
  }
  switch (intent.type) {
    case 'openScreen': {
      const screen = asString(intent.screen);
      if (!screen) {
        return undefined;
      }
      return { type: 'openScreen', screen, params: asStringMap(intent.params) };
    }
    case 'openUrl': {
      const url = asString(intent.url);
      if (!url) {
        return undefined;
      }
      return { type: 'openUrl', url };
    }
    case 'none':
      return { type: 'none' };
    default:
      return undefined;
  }
}

const PARSERS: Record<number, (payload: Record<string, unknown>) => NotificationIntent | undefined> = {
  1: parseV1,
  2: parseV2,
  3: parseV3,
};

/**
 * Validate and map a raw push payload to the current intent model.
 * Unknown versions and malformed payloads are ignored safely.
 */
export function parseNotificationPayload(raw: unknown): ParseResult {
  if (!isRecord(raw)) {
    return { status: 'ignored', reason: 'malformed' };
  }

  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { status: 'ignored', reason: 'malformed' };
  }

  if (!SUPPORTED_VERSIONS.includes(version)) {
    return { status: 'ignored', reason: 'unknownVersion' };
  }

  const parser = PARSERS[version];
  const intent = parser ? parser(raw) : undefined;
  if (!intent) {
    return { status: 'ignored', reason: 'malformed' };
  }

  return { status: 'ok', intent };
}

/**
 * Handle an incoming notification payload. Returns the resolved intent or null
 * when the payload should be ignored. Raw payloads are never logged.
 */
export function handleNotificationPayload(raw: unknown): NotificationIntent | null {
  const result = parseNotificationPayload(raw);
  if (result.status !== 'ok') {
    return null;
  }
  return result.intent;
}
