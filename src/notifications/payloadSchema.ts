/**
 * Notification payload schema versioning and migration.
 *
 * Push payloads can outlive a mobile release, so every payload carries an
 * explicit schema version. Payloads are validated before use and mapped to the
 * current intent model via a compatibility parser that understands supported
 * prior versions. Unknown versions are ignored safely.
 */

export const CURRENT_PAYLOAD_VERSION = 2;

/** Versions this build can still parse and map to the current intent model. */
export const SUPPORTED_PAYLOAD_VERSIONS: readonly number[] = [1, 2];

/**
 * Current intent model. Handlers and routing consume this shape only.
 */
export interface NotificationIntent {
  type: 'open_screen' | 'open_url' | 'noop';
  screen?: string;
  url?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

/**
 * Result of parsing a raw payload. `ignored` is returned for unknown versions
 * or malformed payloads so callers can drop them without crashing or
 * misrouting.
 */
export type ParseResult =
  | { status: 'ok'; version: number; intent: NotificationIntent }
  | { status: 'ignored'; reason: 'unknown_version' | 'malformed' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Maps a v1 payload to the current intent model.
 * v1 used `action`/`target` instead of `type`/`screen`/`url`.
 */
function migrateV1(payload: Record<string, unknown>): NotificationIntent | null {
  const action = asString(payload.action);
  const target = asString(payload.target);

  switch (action) {
    case 'navigate':
      if (!target) {
        return null;
      }
      return {
        type: 'open_screen',
        screen: target,
        title: asString(payload.title),
        body: asString(payload.body),
      };
    case 'open_url':
      if (!target) {
        return null;
      }
      return {
        type: 'open_url',
        url: target,
        title: asString(payload.title),
        body: asString(payload.body),
      };
    case 'dismiss':
      return { type: 'noop' };
    default:
      return null;
  }
}

/**
 * Validates a v2 payload against the current intent model.
 */
function parseV2(payload: Record<string, unknown>): NotificationIntent | null {
  const type = asString(payload.type);

  switch (type) {
    case 'open_screen': {
      const screen = asString(payload.screen);
      if (!screen) {
        return null;
      }
      return {
        type: 'open_screen',
        screen,
        title: asString(payload.title),
        body: asString(payload.body),
        data: isRecord(payload.data) ? payload.data : undefined,
      };
    }
    case 'open_url': {
      const url = asString(payload.url);
      if (!url) {
        return null;
      }
      return {
        type: 'open_url',
        url,
        title: asString(payload.title),
        body: asString(payload.body),
        data: isRecord(payload.data) ? payload.data : undefined,
      };
    }
    case 'noop':
      return { type: 'noop' };
    default:
      return null;
  }
}

/**
 * Compatibility parser: validates a raw payload and maps supported versions to
 * the current intent model. Unknown versions and malformed payloads are
 * ignored safely. Raw payloads are never logged.
 */
export function parseNotificationPayload(raw: unknown): ParseResult {
  if (!isRecord(raw)) {
    return { status: 'ignored', reason: 'malformed' };
  }

  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { status: 'ignored', reason: 'malformed' };
  }

  if (!SUPPORTED_PAYLOAD_VERSIONS.includes(version)) {
    return { status: 'ignored', reason: 'unknown_version' };
  }

  let intent: NotificationIntent | null = null;
  if (version === 1) {
    intent = migrateV1(raw);
  } else if (version === 2) {
    intent = parseV2(raw);
  }

  if (!intent) {
    return { status: 'ignored', reason: 'malformed' };
  }

  return { status: 'ok', version, intent };
}
