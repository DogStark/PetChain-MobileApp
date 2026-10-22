/**
 * Notification payload fixtures for schema version migration tests.
 *
 * Each fixture is a raw push payload as it would arrive from the wire.
 * Supported versions are exercised here; unknown/malformed payloads are
 * included to prove they are ignored safely.
 */

export type RawNotificationPayload = Record<string, unknown>;

/** Current schema version understood by the intent model. */
export const CURRENT_SCHEMA_VERSION = 2;

/** Prior schema versions that still have a compatibility parser. */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;

/**
 * v1 payloads used a flat shape with `type` + `data`.
 * The compatibility parser maps these onto the current intent model.
 */
export const v1Payloads: RawNotificationPayload[] = [
  {
    schemaVersion: 1,
    type: 'message',
    data: { conversationId: 'conv-1', messageId: 'msg-1' },
  },
  {
    schemaVersion: 1,
    type: 'follow',
    data: { userId: 'user-1' },
  },
  {
    schemaVersion: 1,
    type: 'open_screen',
    data: { screen: 'settings' },
  },
];

/**
 * v2 payloads use the current intent model with an explicit `intent` field.
 */
export const v2Payloads: RawNotificationPayload[] = [
  {
    schemaVersion: 2,
    intent: { kind: 'message', conversationId: 'conv-2', messageId: 'msg-2' },
  },
  {
    schemaVersion: 2,
    intent: { kind: 'follow', userId: 'user-2' },
  },
  {
    schemaVersion: 2,
    intent: { kind: 'open_screen', screen: 'settings' },
  },
];

/**
 * Payloads with a version we do not understand. These must be ignored
 * safely: no crash, no misrouting.
 */
export const unknownVersionPayloads: RawNotificationPayload[] = [
  { schemaVersion: 0, intent: { kind: 'message', conversationId: 'conv-x' } },
  { schemaVersion: 3, intent: { kind: 'message', conversationId: 'conv-y' } },
  { schemaVersion: 999, type: 'message', data: { conversationId: 'conv-z' } },
  { schemaVersion: '2', intent: { kind: 'follow', userId: 'user-x' } },
  { schemaVersion: null, intent: { kind: 'follow', userId: 'user-y' } },
];

/**
 * Malformed payloads that must not crash handlers or route incorrectly.
 */
export const malformedPayloads: RawNotificationPayload[] = [
  {},
  { schemaVersion: 2 },
  { schemaVersion: 2, intent: null },
  { schemaVersion: 2, intent: {} },
  { schemaVersion: 2, intent: { kind: 'message' } },
  { schemaVersion: 1, type: 'message' },
  { schemaVersion: 1, type: 'unknown_type', data: {} },
  { schemaVersion: 1, data: { conversationId: 'conv-1' } },
  { schemaVersion: 2, intent: { kind: 'open_screen' } },
  { schemaVersion: 2, intent: { kind: 'message', conversationId: 42 } },
];

/**
 * All fixtures grouped by expectation, for table-driven tests.
 */
export const notificationPayloadFixtures = {
  currentSchemaVersion: CURRENT_SCHEMA_VERSION,
  supportedSchemaVersions: SUPPORTED_SCHEMA_VERSIONS,
  v1: v1Payloads,
  v2: v2Payloads,
  unknownVersion: unknownVersionPayloads,
  malformed: malformedPayloads,
};
