interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface CacheOptions {
  ttl?: number;
  maxSize?: number;
}

const DEFAULT_TTL = 60_000;
const DEFAULT_MAX_SIZE = 200;

export class CacheManager {
  private store = new Map<string, CacheEntry<unknown>>();
  private readonly ttl: number;
  private readonly maxSize: number;

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl ?? DEFAULT_TTL;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttl = this.ttl): void {
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      this.store.delete(this.store.keys().next().value as string);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePattern(pattern: RegExp): void {
    for (const key of this.store.keys()) {
      if (pattern.test(key)) this.store.delete(key);
    }
  }

  async warm<T>(
    entries: Array<{ key: string; loader: () => Promise<T>; ttl?: number }>,
  ): Promise<void> {
    await Promise.all(
      entries.map(async ({ key, loader, ttl }) => {
        try {
          const value = await loader();
          this.set(key, value, ttl);
        } catch {
          // warming failures are non-fatal
        }
      }),
    );
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

export const cacheManager = new CacheManager();
