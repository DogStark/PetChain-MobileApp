import type http from 'http';

import CryptoJS from 'crypto-js';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';

import { store } from './store';

const PING_INTERVAL = 30000; // 30s
const MAX_MESSAGES_PER_SECOND = 5;

function verifyJwt(token: string | undefined) {
  if (!token) return null;
  if (token.startsWith('mock-')) {
    const id = token.slice('mock-'.length);
    return store.users.get(id) ?? null;
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

function encryptPayload(obj: any) {
  const key = process.env.WS_PAYLOAD_KEY || process.env.JWT_SECRET || 'default-ws-key';
  const str = JSON.stringify(obj);
  const ciphertext = CryptoJS.AES.encrypt(str, key).toString();
  return `enc:${ciphertext}`;
}

function decryptPayload(msg: string) {
  if (!msg.startsWith('enc:')) return JSON.parse(msg);
  const key = process.env.WS_PAYLOAD_KEY || process.env.JWT_SECRET || 'default-ws-key';
  const ciphertext = msg.slice(4);
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  const plaintext = bytes.toString(CryptoJS.enc.Utf8);
  return JSON.parse(plaintext);
}

export function initWebsocket(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true, clientTracking: true });

  server.on('upgrade', (req, socket, head) => {
    // Expect Authorization: Bearer <token>
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const user = verifyJwt(token);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket as any, head, (ws) => {
      (ws as any).user = user;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, _req) => {
    (ws as any).isAlive = true;
    (ws as any).msgTimestamps = [] as number[];

    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const raw = data.toString();
        const msg = decryptPayload(raw);

        // rate limiting: sliding window per second
        const now = Date.now();
        const stamps = (ws as any).msgTimestamps as number[];
        // remove older than 1s
        while (stamps.length && stamps[0] <= now - 1000) stamps.shift();
        if (stamps.length >= MAX_MESSAGES_PER_SECOND) {
          ws.send(
            JSON.stringify({ type: 'error', code: 'RATE_LIMIT', message: 'Too many messages' }),
          );
          return;
        }
        stamps.push(now);

        // handle message types (simple echoes / placeholder handlers)
        if (msg?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        } else if (msg?.type === 'sos') {
          // For sensitive data, ensure data is encrypted when broadcasting
          const payload = { type: 'sos', data: msg.data, from: (ws as any).user?.id || null };
          const enc = encryptPayload(payload);
          // broadcast to all authenticated clients
          wss.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN) c.send(enc);
          });
        } else {
          // default echo
          ws.send(JSON.stringify({ type: 'echo', data: msg }));
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      // cleanup if needed
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if ((ws as any).isAlive === false) return ws.terminate();
      (ws as any).isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    });
  }, PING_INTERVAL);

  wss.on('close', () => clearInterval(interval));

  return wss;
}

export { encryptPayload, decryptPayload };
