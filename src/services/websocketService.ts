import CryptoJS from 'crypto-js';

type Message = { type: string; data?: any };
type Listener = (data: any) => void;

function encryptPayload(obj: any) {
  const key = process.env.WS_PAYLOAD_KEY || process.env.JWT_SECRET || 'default-ws-key';
  const str = JSON.stringify(obj);
  return `enc:${CryptoJS.AES.encrypt(str, key).toString()}`;
}

function decryptPayload(msg: string) {
  if (!msg.startsWith('enc:')) return JSON.parse(msg);
  const key = process.env.WS_PAYLOAD_KEY || process.env.JWT_SECRET || 'default-ws-key';
  const ciphertext = msg.slice(4);
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  const plaintext = bytes.toString(CryptoJS.enc.Utf8);
  return JSON.parse(plaintext);
}

export class WebsocketService {
  private url: string;
  private token?: string;
  private ws?: WebSocket | null;
  private shouldReconnect = true;
  private backoffMs = 500;
  private maxBackoff = 30000;
  private pingInterval?: number;
  private lastPong = Date.now();
  private sendTimestamps: number[] = [];
  private maxMessagesPerSecond = 5;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
  }

  /** Subscribe to a message type. Returns an unsubscribe function. */
  on(type: string, listener: Listener): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  connect(token?: string) {
    this.token = token;
    this.shouldReconnect = true;
    this._connect();
  }

  private _connect() {
    const headers: any = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    // React Native WebSocket doesn't accept headers param; include token in query as fallback
    const connectUrl = this.url + (this.token ? `?token=${encodeURIComponent(this.token)}` : '');
    this.ws = new WebSocket(connectUrl);

    this.ws.onopen = () => {
      this.backoffMs = 500;
      this.startHeartbeat();
      this._emit('connected', null);
    };

    this.ws.onmessage = (ev) => {
      try {
        const data = typeof ev.data === 'string' ? ev.data : ev.data.toString();
        const msg = decryptPayload(data);
        if (msg?.type === 'pong') {
          this.lastPong = Date.now();
          return;
        }
        this._emit(msg.type, msg.data);
      } catch (e) {
        console.warn('WS invalid message', e);
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this._emit('disconnected', null);
      if (this.shouldReconnect) this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('WS error', err);
      // close will trigger reconnect
    };
  }

  private _emit(type: string, data: any) {
    this.listeners.get(type)?.forEach((fn) => fn(data));
  }

  private scheduleReconnect() {
    setTimeout(() => {
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoff);
      this._connect();
    }, this.backoffMs);
  }

  disconnect() {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.ws?.close();
  }

  private startHeartbeat() {
    this.lastPong = Date.now();
    this.pingInterval = setInterval(() => {
      try {
        this.ws?.send(JSON.stringify({ type: 'ping' }));
      } catch (err) {
        console.warn('WS ping send error', err);
      }
      // if no pong for 2 intervals, consider connection dead
      if (Date.now() - this.lastPong > 60000) {
        try {
          this.ws?.close();
        } catch (err) {
          console.warn('WS close error', err);
        }
      }
    }, 30000) as unknown as number;
  }

  private stopHeartbeat() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = undefined;
  }

  send(msg: Message, sensitive = false) {
    // rate limiting
    const now = Date.now();
    while (this.sendTimestamps.length && this.sendTimestamps[0] <= now - 1000)
      this.sendTimestamps.shift();
    if (this.sendTimestamps.length >= this.maxMessagesPerSecond) {
      throw new Error('Rate limit exceeded');
    }
    this.sendTimestamps.push(now);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    const payload = sensitive ? encryptPayload(msg) : JSON.stringify(msg);
    this.ws.send(payload);
  }
}

export default WebsocketService;
