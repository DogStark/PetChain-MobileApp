interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  category?: string;
  size?: number;
  protected?: boolean;
}

export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
}

export interface CacheSetOptions {
  ttl?: number;
  category?: string;
  size?: number;
  /**
   * Mark the entry as user-authored and unsynchronized. Protected
   * entries are never removed by automatic eviction or cleanup.
   */
  protected?: boolean;
}

export interface CacheCategoryUsage {
  category: string;
  entries: number;
  bytes: number;
  protectedEntries: number;
  protectedBytes: number;
}

export interface CacheUsageReport {
  totalEntries: number;
  totalBytes: number;
  protectedEntries: number;
  protectedBytes: number;
  categories: CacheCategoryUsage[];
}

export interface CacheCleanupOptions {
  /** Only clean these categories. Omit to clean all categories. */
  categories?: string[];
  /** Only clean entries that have already expired. */
  expiredOnly?: boolean;
  /**
   * Whether to also remove protected (unsynchronized user-authored)
   * entries. Defaults to false so drafts are preserved.
   */
  includeProtected?: boolean;
}

export interface CacheCleanupResult {
  removedEntries: number;
  removedBytes: number;
  preservedEntries: number;
  preservedBytes: number;
  removedKeys: string[];
}

const DEFAULT_TTL = 60_000;
const DEFAULT_MAX_SIZE = 200;
const DEFAULT_CATEGORY = "general";

function estimateSize(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized == null ? 0 : Buffer.byteLength(serialized, "utf8");
  } catch {
    return 0;
  }
}

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

  set<T>(key: string, value: T, options: CacheSetOptions = {}): void {
    const ttl = options.ttl ?? this.ttl;
    const category = options.category ?? DEFAULT_CATEGORY;
    const size = options.size ?? estimateSize(value);
    const protected = options.protected ?? false;

    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      this.evictOldest();
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      category,
      size,
      protected,
    });
  }

  /**
   * Mark an existing entry as protected or unprotected. Used to preserve
   * unsynchronized user-authored drafts across cleanups.
   */
  setProtected(key: string, protected: boolean): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    entry.protected = protected;
    return true;
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
    entries: Array<{
      key: string;
      loader: () => Promise<T>;
      ttl?: number;
      category?: string;
      protected?: boolean;
    }>,
  ): Promise<void> {
    await Promise.all(
      entries.map(async ({ key, loader, ttl, category, protected }) => {
        try {
          const value = await loader();
          this.set(key, value, { ttl, category, protected });
        } catch {
          // warming failures are non-fatal
        }
      }),
    );
  }

  /**
   * Returns a storage usage breakdown by category, separating cached media
   * and records from protected unsynchronized drafts. Expired entries are
   * pruned before reporting so the numbers reflect live storage.
   */
  getUsage(): CacheUsageReport {
    this.pruneExpired();

    const byCategory = new Map<string, CacheCategoryUsage>();
    let totalBytes = 0;
    let protectedEntries = 0;
    let protectedBytes = 0;

    for (const entry of this.store.values()) {
      const category = entry.category ?? DEFAULT_CATEGORY;
      const bytes = entry.size ?? 0;
      const aggregate =
        byCategory.get(category) ??
        ({ category, entries: 0, bytes: 0, protectedEntries: 0, protectedBytes: 0 } as CacheCategoryUsage);
      aggregate.entries += 1;
      aggregate.bytes += bytes;
      if (entry.protected) {
        aggregate.protectedEntries += 1;
        aggregate.protectedBytes += bytes;
        protectedEntries += 1;
        protectedBytes += bytes;
      }
      byCategory.set(category, aggregate);
      totalBytes += bytes;
    }

    return {
      totalEntries: this.store.size,
      totalBytes,
      protectedEntries,
      protectedBytes,
      categories: Array.from(byCategory.values()).sort((a, b) => a.category.localeCompare(b.category)),
    };
  }

  /**
   * Selectively clean cached media and records while preserving protected
   * unsynchronized user-authored drafts by default.
   */
  cleanup(options: CacheCleanupOptions = {}): CacheCleanupResult {
    const categories = options.categories ? new Set(options.categories) : null;
    const expiredOnly = options.expiredOnly ?? false;
    const includeProtected = options.includeProtected ?? false;
    const now = Date.now();

    const removedKeys: string[] = [];
    let removedBytes = 0;
    let preservedEntries = 0;
    let preservedBytes = 0;

    for (const [key, entry] of this.store) {
      const category = entry.category ?? DEFAULT_CATEGORY;
      const inScope = !categories || categories.has(category);
      const isExpired = now > entry.expiresAt;
      const isProtected = entry.protected === true;

      const matches = inScope && (!expiredOnly || isExpired);
      if (!matches) {
        preservedEntries += 1;
        preservedBytes += entry.size ?? 0;
        continue;
      }

      if (isProtected && !includeProtected) {
        preservedEntries += 1;
        preservedBytes += entry.size ?? 0;
        continue;
      }

      removedKeys.push(key);
      removedBytes += entry.size ?? 0;
      this.store.delete(key);
    }

    return {
      removedEntries: removedKeys.length,
      removedBytes,
      preservedEntries,
      preservedBytes,
      removedKeys,
    };
  }

  /**
   * Clear all entries. Protected drafts are preserved unless forced.
   */
  clear(options: { includeProtected?: boolean } = {}): void {
    if (options.includeProtected) {
      this.store.clear();
      return;
    }
    for (const [key, entry] of this.store) {
      if (!entry.protected) this.store.delete(key);
    }
  }

  get size(): number {
    return this.store.size;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  private evictOldest(): void {
    for (const [key, entry] of this.store) {
      if (!entry.protected) {
        this.store.delete(key);
        return;
      }
    }
    // All entries are protected; fall back to removing the oldest entry.
    const oldest = this.store.keys().next().value as string | undefined;
    if (oldest !== undefined) this.store.delete(oldest);
  }
}

export const cacheManager = new CacheManager();
