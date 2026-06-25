import {
  getConversationId,
  getMessages,
  saveMessage,
  markRead,
  type Message,
} from '../messagingService';
import {
  encryptMessage,
  generateKeyPair,
  serializeEncryptedMessage,
} from '../../utils/messageEncryption';

describe('messagingService', () => {
  const userId1 = 'user-1';
  const userId2 = 'user-2';

  // A valid encrypted payload used across tests
  let validEncryptedContent: string;
  let recipientKeyPair: ReturnType<typeof generateKeyPair>;

  beforeAll(() => {
    recipientKeyPair = generateKeyPair();
    const encrypted = encryptMessage('Hello', recipientKeyPair.publicKey);
    validEncryptedContent = serializeEncryptedMessage(encrypted);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getConversationId', () => {
    it('should generate consistent conversation ID', () => {
      const id1 = getConversationId(userId1, userId2);
      const id2 = getConversationId(userId2, userId1);
      expect(id1).toBe(id2);
    });

    it('should sort user IDs alphabetically', () => {
      const id = getConversationId('zebra', 'apple');
      expect(id).toBe('apple:zebra');
    });

    it('should handle identical user IDs', () => {
      const id = getConversationId(userId1, userId1);
      expect(id).toBe(`${userId1}:${userId1}`);
    });

    it('should generate unique IDs for different user pairs', () => {
      const id1 = getConversationId('user-1', 'user-2');
      const id2 = getConversationId('user-1', 'user-3');
      expect(id1).not.toBe(id2);
    });
  });

  describe('saveMessage — E2E encryption enforcement', () => {
    it('should accept a valid encrypted payload', () => {
      const conversationId = getConversationId(userId1, userId2);
      const message = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: validEncryptedContent,
      });

      expect(message.id).toBeDefined();
      expect(message.createdAt).toBeDefined();
      expect(message.senderId).toBe(userId1);
      expect(message.recipientId).toBe(userId2);
    });

    it('should store ciphertext — not the original plaintext', () => {
      const plaintext = 'My pet has a rash on her left ear';
      const encrypted = encryptMessage(plaintext, recipientKeyPair.publicKey);
      const encryptedJson = serializeEncryptedMessage(encrypted);

      const conversationId = getConversationId(userId1, userId2);
      const message = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: encryptedJson,
      });

      // The stored content must never equal the plaintext
      expect(message.content).not.toBe(plaintext);
      expect(message.content).toBe(encryptedJson);

      // The stored JSON must have the four E2E fields
      const parsed = JSON.parse(message.content!) as Record<string, unknown>;
      expect(parsed).toHaveProperty('ephemeralPublicKey');
      expect(parsed).toHaveProperty('iv');
      expect(parsed).toHaveProperty('authTag');
      expect(parsed).toHaveProperty('ciphertext');
    });

    it('should throw when content is plaintext (not encrypted)', () => {
      const conversationId = getConversationId(userId1, userId2);
      expect(() =>
        saveMessage({
          conversationId,
          senderId: userId1,
          recipientId: userId2,
          content: 'plain text message',
        }),
      ).toThrow(/E2E-encrypted payload/);
    });

    it('should throw when content is JSON but not an encrypted payload', () => {
      const conversationId = getConversationId(userId1, userId2);
      expect(() =>
        saveMessage({
          conversationId,
          senderId: userId1,
          recipientId: userId2,
          content: JSON.stringify({ text: 'Hello' }),
        }),
      ).toThrow(/E2E-encrypted payload/);
    });

    it('should allow messages with no content (attachment-only)', () => {
      const conversationId = getConversationId(userId1, userId2);
      const message = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        attachmentUrl: 'https://example.com/image.jpg',
        attachmentType: 'image',
      });

      expect(message.attachmentUrl).toBe('https://example.com/image.jpg');
      expect(message.content).toBeUndefined();
    });

    it('should generate unique message IDs for each call', () => {
      const conversationId = getConversationId(userId1, userId2);

      const msg1 = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: validEncryptedContent,
      });
      const msg2 = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: validEncryptedContent,
      });

      expect(msg1.id).not.toBe(msg2.id);
    });

    it('should not have readAt timestamp initially', () => {
      const conversationId = getConversationId(userId1, userId2);
      const message = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: validEncryptedContent,
      });

      expect(message.readAt).toBeUndefined();
    });
  });

  describe('getMessages', () => {
    it('should retrieve encrypted messages from a conversation', () => {
      const conversationId = getConversationId(userId1, userId2);

      const enc1 = serializeEncryptedMessage(encryptMessage('msg1', recipientKeyPair.publicKey));
      const enc2 = serializeEncryptedMessage(encryptMessage('msg2', recipientKeyPair.publicKey));

      saveMessage({ conversationId, senderId: userId1, recipientId: userId2, content: enc1 });
      saveMessage({ conversationId, senderId: userId2, recipientId: userId1, content: enc2 });

      const msgs = getMessages(conversationId);
      expect(msgs.length).toBeGreaterThanOrEqual(2);
      // All stored messages must look like encrypted payloads
      msgs.forEach((m) => {
        if (m.content !== undefined) {
          const parsed = JSON.parse(m.content) as Record<string, unknown>;
          expect(parsed).toHaveProperty('ephemeralPublicKey');
          expect(parsed).toHaveProperty('ciphertext');
        }
      });
    });

    it('should return empty array for non-existent conversation', () => {
      const msgs = getMessages('non-existent-conversation');
      expect(msgs).toEqual([]);
    });

    it('should respect limit parameter', () => {
      const conversationId = getConversationId('limit-test-1', 'limit-test-2');

      for (let i = 0; i < 10; i++) {
        const enc = serializeEncryptedMessage(
          encryptMessage(`msg${i}`, recipientKeyPair.publicKey),
        );
        saveMessage({
          conversationId,
          senderId: 'limit-test-1',
          recipientId: 'limit-test-2',
          content: enc,
        });
      }

      const msgs = getMessages(conversationId, 5);
      expect(msgs.length).toBe(5);
    });

    it('should return most recent messages when limit is applied', () => {
      const conversationId = getConversationId('order-test-1', 'order-test-2');

      for (let i = 0; i < 5; i++) {
        const enc = serializeEncryptedMessage(
          encryptMessage(`msg${i}`, recipientKeyPair.publicKey),
        );
        saveMessage({
          conversationId,
          senderId: 'order-test-1',
          recipientId: 'order-test-2',
          content: enc,
        });
      }

      const msgs = getMessages(conversationId, 3);
      expect(msgs.length).toBe(3);
    });

    it('should support pagination with before parameter', () => {
      const conversationId = getConversationId('before-test-1', 'before-test-2');
      const saved: Message[] = [];

      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(100);
        const enc = serializeEncryptedMessage(
          encryptMessage(`msg${i}`, recipientKeyPair.publicKey),
        );
        const msg = saveMessage({
          conversationId,
          senderId: 'before-test-1',
          recipientId: 'before-test-2',
          content: enc,
        });
        saved.push(msg);
      }

      const beforeTime = saved[3].createdAt;
      const msgs = getMessages(conversationId, 10, beforeTime);

      expect(msgs.length).toBeLessThan(5);
      expect(msgs.every((m) => m.createdAt < beforeTime)).toBe(true);
    });
  });

  describe('markRead', () => {
    it('should mark encrypted messages as read', () => {
      const conversationId = getConversationId('read-test-1', 'read-test-2');
      const enc = serializeEncryptedMessage(encryptMessage('hello', recipientKeyPair.publicKey));

      saveMessage({
        conversationId,
        senderId: 'read-test-1',
        recipientId: 'read-test-2',
        content: enc,
      });
      saveMessage({
        conversationId,
        senderId: 'read-test-1',
        recipientId: 'read-test-2',
        content: enc,
      });

      markRead(conversationId, 'read-test-2');

      const msgs = getMessages(conversationId);
      expect(msgs.every((m) => m.readAt !== undefined)).toBe(true);
    });

    it('should only mark messages for specific recipient', () => {
      const conversationId = getConversationId('read-specific-1', 'read-specific-2');
      const enc = serializeEncryptedMessage(encryptMessage('hello', recipientKeyPair.publicKey));

      const msg1 = saveMessage({
        conversationId,
        senderId: 'read-specific-1',
        recipientId: 'read-specific-2',
        content: enc,
      });
      const msg2 = saveMessage({
        conversationId,
        senderId: 'read-specific-2',
        recipientId: 'read-specific-1',
        content: enc,
      });

      markRead(conversationId, 'read-specific-2');

      const msgs = getMessages(conversationId);
      const markedMsg = msgs.find((m) => m.id === msg1.id);
      const unmarkedMsg = msgs.find((m) => m.id === msg2.id);

      expect(markedMsg?.readAt).toBeDefined();
      expect(unmarkedMsg?.readAt).toBeUndefined();
    });

    it('should not overwrite existing readAt timestamp', () => {
      const conversationId = getConversationId('read-idempotent-1', 'read-idempotent-2');
      const enc = serializeEncryptedMessage(encryptMessage('hello', recipientKeyPair.publicKey));

      saveMessage({
        conversationId,
        senderId: 'read-idempotent-1',
        recipientId: 'read-idempotent-2',
        content: enc,
      });

      markRead(conversationId, 'read-idempotent-2');
      const firstReadAt = getMessages(conversationId)[0].readAt;

      jest.advanceTimersByTime(1000);

      markRead(conversationId, 'read-idempotent-2');
      const secondReadAt = getMessages(conversationId)[0].readAt;

      expect(firstReadAt).toBe(secondReadAt);
    });

    it('should handle non-existent conversation gracefully', () => {
      expect(() => {
        markRead('non-existent-conversation', userId1);
      }).not.toThrow();
    });

    it('should set a valid readAt timestamp', () => {
      const conversationId = getConversationId('read-ts-1', 'read-ts-2');
      const enc = serializeEncryptedMessage(encryptMessage('hello', recipientKeyPair.publicKey));

      saveMessage({
        conversationId,
        senderId: 'read-ts-1',
        recipientId: 'read-ts-2',
        content: enc,
      });

      const beforeTime = new Date();
      markRead(conversationId, 'read-ts-2');
      const afterTime = new Date();

      const msgs = getMessages(conversationId);
      const readAt = new Date(msgs[0].readAt!);

      expect(readAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(readAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('Message structure', () => {
    it('should have all required fields', () => {
      const conversationId = getConversationId(userId1, userId2);
      const message = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: validEncryptedContent,
      });

      expect(message).toHaveProperty('id');
      expect(message).toHaveProperty('conversationId');
      expect(message).toHaveProperty('senderId');
      expect(message).toHaveProperty('recipientId');
      expect(message).toHaveProperty('content');
      expect(message).toHaveProperty('createdAt');
    });

    it('should support optional attachment fields', () => {
      const conversationId = getConversationId(userId1, userId2);
      const message = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        attachmentUrl: 'https://example.com/file.pdf',
        attachmentType: 'document',
      });

      expect(message.attachmentUrl).toBe('https://example.com/file.pdf');
      expect(message.attachmentType).toBe('document');
    });
  });
});
