interface CacheItem<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface CacheStats {
  size: number;
  itemCount: number;
}

interface CacheBreakdown {
  media: CacheStats;
  records: CacheStats;
  drafts: CacheStats;
  total: CacheStats;
}

interface CleanupOptions {
  media?: boolean;
  records?: boolean;
  expiredOnly?: boolean;
}

class CacheManager {
  private cache = new Map<string, CacheItem<unknown>>();
  private readonly maxSize: number;
  private readonly defaultTTL: number;

  constructor(maxSize = 50 * 1024 * 1024, defaultTTL = 24 * 60 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  async cacheData<T>(key: string, data: T, ttl?: number): Promise<void> {
    const item: CacheItem<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    };

    this.cache.set(key, item);
    await this.manageCacheSize();
  }

  async getCachedData<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key);

    if (!item) return null;

    if (this.isExpired(item)) {
      this.cache.delete(key);
      return null;
    }

    return item.data as T;
  }

  async warmCache<T>(
    entries: Array<{ key: string; loader: () => Promise<T>; ttl?: number }>,
  ): Promise<void> {
    await Promise.all(
      entries.map(async ({ key, loader, ttl }) => {
        try {
          const data = await loader();
          await this.cacheData(key, data, ttl);
        } catch {
          // warming failures are non-fatal
        }
      }),
    );
  }

  invalidatePattern(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) this.cache.delete(key);
    }
  }

  async invalidateCache(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clearExpiredCache(): Promise<void> {
    const expiredKeys: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (this.isExpired(item)) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach((key) => this.cache.delete(key));
  }

  async getCacheSize(): Promise<CacheStats> {
    const size = this.calculateCacheSize();
    return {
      size,
      itemCount: this.cache.size,
    };
  }

  async clearCache(): Promise<void> {
    this.cache.clear();
  }

  async getCacheBreakdown(): Promise<CacheBreakdown> {
    const media: CacheStats = { size: 0, itemCount: 0 };
    const records: CacheStats = { size: 0, itemCount: 0 };
    const drafts: CacheStats = { size: 0, itemCount: 0 };

    for (const [key, item] of this.cache.entries()) {
      const itemSize = JSON.stringify(item).length * 2;
      const bucket = this.classifyKey(key);
      bucket.size += itemSize;
      bucket.itemCount += 1;
    }

    return {
      media,
      records,
      drafts,
      total: await this.getCacheSize(),
    };
  }

  async cleanupCache(options: CleanupOptions = {}): Promise<CacheStats> {
    const { media = true, records = true, expiredOnly = false } = options;
    const removedKeys: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      // Never remove unsynchronized user-authored drafts.
      if (this.isDraftKey(key)) continue;

      const bucket = this.classifyKey(key);
      const inScope =
        (media && bucket === this.mediaBucket) ||
        (records && bucket === this.recordsBucket);

      if (!inScope) continue;
      if (expiredOnly && !this.isExpired(item)) continue;

      removedKeys.push(key);
    }

    let freedSize = 0;
    for (const key of removedKeys) {
      const item = this.cache.get(key);
      if (item) freedSize += JSON.stringify(item).length * 2;
      this.cache.delete(key);
    }

    return { size: freedSize, itemCount: removedKeys.length };
  }

  private readonly mediaBucket: CacheStats = { size: 0, itemCount: 0 };
  private readonly recordsBucket: CacheStats = { size: 0, itemCount: 0 };

  private classifyKey(key: string): CacheStats {
    if (this.isMediaKey(key)) return this.mediaBucket;
    return this.recordsBucket;
  }

  private isMediaKey(key: string): boolean {
    return /^(media|image|photo|video|attachment):/i.test(key);
  }

  private isDraftKey(key: string): boolean {
    return /^draft:/i.test(key);
  }

  async resolveConflict<T>(key: string, localData: T, remoteData: T): Promise<T> {
    const localItem = this.cache.get(key);

    if (!localItem) return remoteData;

    // Use timestamp-based resolution (latest wins)
    const remoteTimestamp = Date.now();
    const localTimestamp = localItem.timestamp;

    const resolvedData = remoteTimestamp > localTimestamp ? remoteData : localData;

    await this.cacheData(key, resolvedData);
    return resolvedData;
  }

  private isExpired(item: CacheItem<unknown>): boolean {
    return Date.now() - item.timestamp > item.ttl;
  }

  private calculateCacheSize(): number {
    let size = 0;
    for (const item of this.cache.values()) {
      size += JSON.stringify(item).length * 2; // Rough byte estimation
    }
    return size;
  }

  private async manageCacheSize(): Promise<void> {
    await this.clearExpiredCache();

    if (this.calculateCacheSize() > this.maxSize) {
      await this.evictOldestItems();
    }
  }

  private async evictOldestItems(): Promise<void> {
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    while (this.calculateCacheSize() > this.maxSize * 0.8 && entries.length > 0) {
      const shifted = entries.shift();
      if (shifted) this.cache.delete(shifted[0]);
    }
  }
}

// Pet-specific cache manager
export class PetCacheManager extends CacheManager {
  private static instance: PetCacheManager;

  static getInstance(): PetCacheManager {
    if (!PetCacheManager.instance) {
      PetCacheManager.instance = new PetCacheManager();
    }
    return PetCacheManager.instance;
  }

  async cachePet(petId: string, petData: unknown): Promise<void> {
    await this.cacheData(`pet:${petId}`, petData);
  }

  async getCachedPet(petId: string): Promise<unknown> {
    return await this.getCachedData(`pet:${petId}`);
  }

  async cachePetList(pets: unknown[]): Promise<void> {
    await this.cacheData('pets:list', pets);
  }

  async getCachedPetList(): Promise<unknown[] | null> {
    return await this.getCachedData<unknown[]>('pets:list');
  }

  async invalidatePet(petId: string): Promise<void> {
    await this.invalidateCache(`pet:${petId}`);
    await this.invalidateCache('pets:list');
  }

  async cacheDraft(draftId: string, draftData: unknown): Promise<void> {
    await this.cacheData(`draft:${draftId}`, draftData);
  }

  async getCachedDraft(draftId: string): Promise<unknown> {
    return await this.getCachedData(`draft:${draftId}`);
  }

  async getStorageUsage(): Promise<CacheBreakdown> {
    return await this.getCacheBreakdown();
  }

  async cleanupStorage(options: CleanupOptions = {}): Promise<CacheStats> {
    return await this.cleanupCache(options);
  }

  async syncPetData(petId: string, remoteData: unknown): Promise<unknown> {
    const localData = await this.getCachedPet(petId);
    if (localData) {
      return await this.resolveConflict(`pet:${petId}`, localData, remoteData);
    }
    await this.cachePet(petId, remoteData);
    return remoteData;
  }
}

export default PetCacheManager.getInstance();
