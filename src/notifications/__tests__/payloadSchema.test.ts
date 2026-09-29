import {
  CURRENT_PAYLOAD_VERSION,
  parseNotificationPayload,
  type NotificationIntent,
} from '../payloadSchema';

describe('notification payload schema versioning', () => {
  it('parses the current version payload', () => {
    const intent = parseNotificationPayload({
      version: CURRENT_PAYLOAD_VERSION,
      type: 'message',
      conversationId: 'conv-1',
      messageId: 'msg-1',
    });

    expect(intent).toEqual<NotificationIntent>({
      kind: 'message',
      conversationId: 'conv-1',
      messageId: 'msg-1',
    });
  });

  it('maps supported prior versions to the current intent model', () => {
    const intent = parseNotificationPayload({
      version: 1,
      type: 'message',
      conversation_id: 'conv-legacy',
      message_id: 'msg-legacy',
    });

    expect(intent).toEqual<NotificationIntent>({
      kind: 'message',
      conversationId: 'conv-legacy',
      messageId: 'msg-legacy',
    });
  });

  it('ignores unknown versions safely', () => {
    expect(
      parseNotificationPayload({
        version: 999,
        type: 'message',
        conversationId: 'conv-1',
      }),
    ).toBeNull();
  });

  it('ignores payloads without a version', () => {
    expect(
      parseNotificationPayload({ type: 'message', conversationId: 'conv-1' }),
    ).toBeNull();
  });

  it('ignores malformed payloads', () => {
    expect(parseNotificationPayload(null)).toBeNull();
    expect(parseNotificationPayload(undefined)).toBeNull();
    expect(parseNotificationPayload('not-an-object')).toBeNull();
    expect(parseNotificationPayload(42)).toBeNull();
    expect(parseNotificationPayload({})).toBeNull();
    expect(parseNotificationPayload({ version: '1' })).toBeNull();
    expect(parseNotificationPayload({ version: 1, type: 'unknown' })).toBeNull();
    expect(
      parseNotificationPayload({ version: 1, type: 'message' }),
    ).toBeNull();
  });
});
