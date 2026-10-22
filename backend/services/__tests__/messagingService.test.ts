import {
  getConversationId,
  getMessages,
  saveMessage,
  markRead,
  type Message,
} from '../messagingService';

describe('messagingService', () => {
  const userId1 = 'user-1';
  const userId2 = 'user-2';

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

  describe('saveMessage', () => {
    it('should save message with generated ID and timestamp', () => {
      const conversationId = getConversationId(userId1, userId2);
      const message = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: 'Hello',
      });

      expect(message.id).toBeDefined();
      expect(message.createdAt).toBeDefined();
      expect(message.content).toBe('Hello');
      expect(message.senderId).toBe(userId1);
      expect(message.recipientId).toBe(userId2);
    });

    it('should generate unique message IDs', () => {
      const conversationId = getConversationId(userId1, userId2);

      const msg1 = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: 'Message 1',
      });

      const msg2 = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: 'Message 2',
      });

      expect(msg1.id).not.toBe(msg2.id);
    });

    it('should save message with attachment', () => {
      const conversationId = getConversationId(userId1, userId2);
      const message = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        attachmentUrl: 'https://example.com/image.jpg',
        attachmentType: 'image',
      });

      expect(message.attachmentUrl).toBe('https://example.com/image.jpg');
      expect(message.attachmentType).toBe('image');
    });

    it('should save message without content if attachment provided', () => {
      const conversationId = getConversationId(userId1, userId2);
      const message = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        attachmentUrl: 'https://example.com/file.pdf',
        attachmentType: 'document',
      });

      expect(message.attachmentUrl).toBeDefined();
      expect(message.content).toBeUndefined();
    });

    it('should not have readAt timestamp initially', () => {
      const conversationId = getConversationId(userId1, userId2);
      const message = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: 'Hello',
      });

      expect(message.readAt).toBeUndefined();
    });
  });

  describe('getMessages', () => {
    it('should retrieve messages from conversation', () => {
      const conversationId = getConversationId(userId1, userId2);

      saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: 'Message 1',
      });

      saveMessage({
        conversationId,
        senderId: userId2,
        recipientId: userId1,
        content: 'Message 2',
      });

      const messages = getMessages(conversationId);

      expect(messages.length).toBe(2);
      expect(messages[0].content).toBe('Message 1');
      expect(messages[1].content).toBe('Message 2');
    });

    it('should return empty array for non-existent conversation', () => {
      const messages = getMessages('non-existent-conversation');

      expect(messages).toEqual([]);
    });

    it('should respect limit parameter', () => {
      const conversationId = getConversationId(userId1, userId2);

      for (let i = 0; i < 10; i++) {
        saveMessage({
          conversationId,
          senderId: userId1,
          recipientId: userId2,
          content: `Message ${i}`,
        });
      }

      const messages = getMessages(conversationId, 5);

      expect(messages.length).toBe(5);
    });

    it('should return most recent messages by default', () => {
      const conversationId = getConversationId(userId1, userId2);

      for (let i = 0; i < 10; i++) {
        saveMessage({
          conversationId,
          senderId: userId1,
          recipientId: userId2,
          content: `Message ${i}`,
        });
      }

      const messages = getMessages(conversationId, 3);

      expect(messages.length).toBe(3);
      expect(messages[0].content).toBe('Message 7');
      expect(messages[1].content).toBe('Message 8');
      expect(messages[2].content).toBe('Message 9');
    });

    it('should support pagination with before parameter', () => {
      const conversationId = getConversationId(userId1, userId2);
      const savedMessages: Message[] = [];

      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(100);
        const msg = saveMessage({
          conversationId,
          senderId: userId1,
          recipientId: userId2,
          content: `Message ${i}`,
        });
        savedMessages.push(msg);
      }

      const beforeTime = savedMessages[3].createdAt;
      const messages = getMessages(conversationId, 10, beforeTime);

      expect(messages.length).toBeLessThan(5);
      expect(messages.every((m) => m.createdAt < beforeTime)).toBe(true);
    });
  });

  describe('markRead', () => {
    it('should mark unread messages as read', () => {
      const conversationId = getConversationId(userId1, userId2);

      saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: 'Message 1',
      });

      saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: 'Message 2',
      });

      markRead(conversationId, userId2);

      const messages = getMessages(conversationId);

      expect(messages.every((m) => m.readAt !== undefined)).toBe(true);
    });

    it('should only mark messages for specific recipient', () => {
      const conversationId = getConversationId(userId1, userId2);

      const msg1 = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: 'To user 2',
      });

      const msg2 = saveMessage({
        conversationId,
        senderId: userId2,
        recipientId: userId1,
        content: 'To user 1',
      });

      markRead(conversationId, userId2);

      const messages = getMessages(conversationId);
      const markedMsg = messages.find((m) => m.id === msg1.id);
      const unmarkedMsg = messages.find((m) => m.id === msg2.id);

      expect(markedMsg?.readAt).toBeDefined();
      expect(unmarkedMsg?.readAt).toBeUndefined();
    });

    it('should not overwrite existing readAt timestamp', () => {
      const conversationId = getConversationId(userId1, userId2);

      const msg = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: 'Message',
      });

      markRead(conversationId, userId2);
      const firstReadAt = getMessages(conversationId)[0].readAt;

      jest.advanceTimersByTime(1000);

      markRead(conversationId, userId2);
      const secondReadAt = getMessages(conversationId)[0].readAt;

      expect(firstReadAt).toBe(secondReadAt);
    });

    it('should handle non-existent conversation gracefully', () => {
      expect(() => {
        markRead('non-existent-conversation', userId1);
      }).not.toThrow();
    });

    it('should set readAt timestamp', () => {
      const conversationId = getConversationId(userId1, userId2);

      saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: 'Message',
      });

      const beforeTime = new Date();
      markRead(conversationId, userId2);
      const afterTime = new Date();

      const messages = getMessages(conversationId);
      const readAt = new Date(messages[0].readAt!);

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
        content: 'Test',
      });

      expect(message).toHaveProperty('id');
      expect(message).toHaveProperty('conversationId');
      expect(message).toHaveProperty('senderId');
      expect(message).toHaveProperty('recipientId');
      expect(message).toHaveProperty('content');
      expect(message).toHaveProperty('createdAt');
    });

    it('should support optional fields', () => {
      const conversationId = getConversationId(userId1, userId2);
      const message = saveMessage({
        conversationId,
        senderId: userId1,
        recipientId: userId2,
        content: 'Test',
        attachmentUrl: 'https://example.com/file.pdf',
        attachmentType: 'document',
      });

      expect(message.attachmentUrl).toBe('https://example.com/file.pdf');
      expect(message.attachmentType).toBe('document');
    });
  });
});
