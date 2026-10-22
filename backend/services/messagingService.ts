import { type IncomingMessage, type Server } from 'http';

import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer, type WebSocket } from 'ws';

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content?: string;
  attachmentUrl?: string;
  attachmentType?: string;
  readAt?: string;
  createdAt: string;
}

// In-memory store (replace with DB queries in production)
const messages = new Map<string, Message[]>(); // conversationId -> messages
const clients = new Map<string, WebSocket>(); // userId -> ws

export function getConversationId(userA: string, userB: string): string {
  return [userA, userB].sort().join(':');
}

export function getMessages(conversationId: string, limit = 50, before?: string): Message[] {
  const all = messages.get(conversationId) ?? [];
  const filtered = before ? all.filter((m) => m.createdAt < before) : all;
  return filtered.slice(-limit);
}

export function saveMessage(msg: Omit<Message, 'id' | 'createdAt'>): Message {
  const saved: Message = { ...msg, id: uuidv4(), createdAt: new Date().toISOString() };
  const list = messages.get(saved.conversationId) ?? [];
  list.push(saved);
  messages.set(saved.conversationId, list);
  return saved;
}

export function markRead(conversationId: string, userId: string): void {
  const list = messages.get(conversationId) ?? [];
  const now = new Date().toISOString();
  list.forEach((m) => {
    if (m.recipientId === userId && !m.readAt) m.readAt = now;
  });
}

export function attachWebSocketServer(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws/messages' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const userId = url.searchParams.get('userId');
    if (!userId) {
      ws.close(4001, 'userId required');
      return;
    }

    clients.set(userId, ws);

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as {
          recipientId: string;
          content?: string;
          attachmentUrl?: string;
          attachmentType?: string;
        };
        const conversationId = getConversationId(userId, data.recipientId);
        const msg = saveMessage({ conversationId, senderId: userId, ...data });

        // Deliver to recipient if online
        const recipientWs = clients.get(data.recipientId);
        if (recipientWs?.readyState === 1) {
          recipientWs.send(JSON.stringify(msg));
        }
        ws.send(JSON.stringify(msg));
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => clients.delete(userId));
  });
}
