import crypto from 'crypto';

/**
 * Per-account encrypted store for cached telemedicine chat messages and
 * attachment metadata.
 *
 * Every account gets its own random data key held in a secure keystore. Cache
 * rows are AES-256-GCM ciphertext keyed by account. On logout / account switch
 * the key is destroyed first and the cache purged second, so even if the purge
 * is interrupted the remaining ciphertext is unreadable by the next account.
 */

export interface SecureKeystore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  sentAt: string;
  attachments?: { id: string; name: string; contentType: string; sizeBytes: number }[];
}

const KEY_PREFIX = 'com.petchain.telemedicine.chatKey.';
const CACHE_PREFIX = 'telemedicine.chatHistory.';

export class InMemoryStore implements SecureKeystore, CacheStore {
  private data = new Map<string, string>();
  async getItemAsync(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItemAsync(key: string, value: string) {
    this.data.set(key, value);
  }
  async deleteItemAsync(key: string) {
    this.data.delete(key);
  }
  get = this.getItemAsync.bind(this);
  set = this.setItemAsync.bind(this);
  delete = this.deleteItemAsync.bind(this);
  async keys() {
    return [...this.data.keys()];
  }
}

export class TelemedicineChatVault {
  constructor(
    private readonly keystore: SecureKeystore,
    private readonly cache: CacheStore,
  ) {}

  private async getOrCreateKey(accountId: string): Promise<Buffer> {
    const stored = await this.keystore.getItemAsync(KEY_PREFIX + accountId);
    if (stored) return Buffer.from(stored, 'base64');
    const key = crypto.randomBytes(32);
    await this.keystore.setItemAsync(KEY_PREFIX + accountId, key.toString('base64'));
    return key;
  }

  async saveHistory(accountId: string, messages: ChatMessage[]): Promise<void> {
    const key = await this.getOrCreateKey(accountId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(messages), 'utf8');
    const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
    await this.cache.set(CACHE_PREFIX + accountId, payload);
  }

  /**
   * Returns [] when no key exists for the account (i.e. after logout) so a
   * different account can never read the previous account's cached history.
   */
  async readHistory(accountId: string): Promise<ChatMessage[]> {
    const rawKey = await this.keystore.getItemAsync(KEY_PREFIX + accountId);
    const payload = await this.cache.get(CACHE_PREFIX + accountId);
    if (!rawKey || !payload) return [];
    try {
      const buf = Buffer.from(payload, 'base64');
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const data = buf.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(rawKey, 'base64'), iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
      return JSON.parse(dec) as ChatMessage[];
    } catch {
      // Tampered or key/ciphertext mismatch: treat as no history rather than leak.
      return [];
    }
  }

  /**
   * Atomic-as-possible teardown: destroy the key first (renders ciphertext
   * useless immediately), then best-effort purge the cache rows.
   */
  async purgeAccount(accountId: string): Promise<void> {
    await this.keystore.deleteItemAsync(KEY_PREFIX + accountId);
    await this.cache.delete(CACHE_PREFIX + accountId);
  }

  async logout(accountId: string): Promise<void> {
    await this.purgeAccount(accountId);
  }

  async switchAccount(previousAccountId: string, nextAccountId: string): Promise<void> {
    if (previousAccountId && previousAccountId !== nextAccountId) {
      await this.purgeAccount(previousAccountId);
    }
    // Pre-provision the next account's key so its first read/write is isolated.
    await this.getOrCreateKey(nextAccountId);
  }
}
