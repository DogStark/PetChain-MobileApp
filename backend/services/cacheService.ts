/**
 * Redis-backed cache service.
 *
 * Implements the Cache-Aside (Lazy Loading) pattern:
 *   1. Check Redis — return on hit.
 *   2. On miss, call the provided loader (DB query / business logic).
 *   3. Populate Redis with the result and return it.
 *
 * All Redis errors are caught and logged; the service falls back to the
 * loader transparently so the application never crashes due to Redis
 * unavailability.
 *
 * Metrics (hit / miss counters) are exposed via `getCacheMetrics()` and
 * the `/api/cache/metrics` endpoint registered in app.ts.
 */

import { getRedisClient, isRedisReady, REDIS_KEY_PREFIX, CACHE_TTL } from '../config/redis';
import { query } from '../src/db';

// ─── Re-export TTL constants so callers don't need to import config/redis ─────
export { CACHE_TTL };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CacheMetrics {
  hits: number;
  misses: number;
  errors: number;
  hitRate: string;
}

// ─── In-process metrics counters ─────────────────────────────────────────────

let hits = 0;
let misses = 0;
let errors = 0;

// ─── Key helpers ─────────────────────────────────────────────────────────────

/** Builds a namespaced Redis key. */
export function cacheKey(...parts: string[]): string {
  return `${REDIS_KEY_PREFIX}${parts.join(':')}`;
}

export const CacheKeys = {
  pet: (id: string) => cacheKey('pet', id),
  petsByOwner: (ownerId: string) => cacheKey('owner', ownerId, 'pets'),
  breed: (name: string) => cacheKey('breed', name.toLowerCase().replace(/\s+/g, '_')),
  allBreeds: () => cacheKey('breeds', 'all'),
  vet: (id: string) => cacheKey('vet', id),
  vetDirectory: (params: string) => cacheKey('vets', 'dir', params),
} as const;

// ─── Core operations ─────────────────────────────────────────────────────────

/**
 * Retrieves a value from Redis.
 * Returns `null` on cache miss, Redis error, or when Redis is unavailable.
 */
export async function get<T>(key: string): Promise<T | null> {
  if (!isRedisReady()) return null;

  try {
    const raw = await getRedisClient().get(key);
    if (raw === null) {
      misses++;
      return null;
    }
    hits++;
    return JSON.parse(raw) as T;
  } catch (err) {
    errors++;
    console.error('[cacheService] get error:', (err as Error).message, { key });
    return null;
  }
}

/**
 * Stores a value in Redis with an optional TTL (seconds).
 * Silently no-ops when Redis is unavailable.
 */
export async function set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (!isRedisReady()) return;

  try {
    await getRedisClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    errors++;
    console.error('[cacheService] set error:', (err as Error).message, { key, ttlSeconds });
  }
}

/**
 * Deletes one or more keys from Redis.
 * Silently no-ops when Redis is unavailable.
 */
export async function invalidate(...keys: string[]): Promise<void> {
  if (!isRedisReady() || keys.length === 0) return;

  try {
    await getRedisClient().del(...keys);
  } catch (err) {
    errors++;
    console.error('[cacheService] invalidate error:', (err as Error).message, { keys });
  }
}

/**
 * Deletes all keys matching a glob pattern (e.g. `petchain:cache:owner:*`).
 * Uses SCAN to avoid blocking the Redis event loop.
 */
export async function invalidatePattern(pattern: string): Promise<void> {
  if (!isRedisReady()) return;

  const client = getRedisClient();
  const keysToDelete: string[] = [];

  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== '0');

    if (keysToDelete.length > 0) {
      await client.del(...keysToDelete);
    }
  } catch (err) {
    errors++;
    console.error('[cacheService] invalidatePattern error:', (err as Error).message, { pattern });
  }
}

// ─── Cache-Aside helper ───────────────────────────────────────────────────────

/**
 * Cache-Aside: check Redis → on miss call `loader` → populate cache → return.
 *
 * @param key        Redis key
 * @param ttl        TTL in seconds
 * @param loader     Async function that fetches the data from the source of truth
 */
export async function getOrSet<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<T> {
  const cached = await get<T>(key);
  if (cached !== null) return cached;

  const data = await loader();
  // Fire-and-forget — don't let a Redis write failure block the response
  set(key, data, ttl).catch(() => {
    /* already logged inside set() */
  });
  return data;
}

// ─── Domain-specific invalidation helpers ────────────────────────────────────

/** Invalidates all cache entries related to a single pet. */
export async function invalidatePet(petId: string, ownerId?: string): Promise<void> {
  const keys = [CacheKeys.pet(petId)];
  if (ownerId) keys.push(CacheKeys.petsByOwner(ownerId));
  await invalidate(...keys);
}

/** Invalidates all vet directory cache entries. */
export async function invalidateVetDirectory(vetId?: string): Promise<void> {
  const tasks: Promise<void>[] = [invalidatePattern(`${REDIS_KEY_PREFIX}vets:dir:*`)];
  if (vetId) tasks.push(invalidate(CacheKeys.vet(vetId)));
  await Promise.all(tasks);
}

// ─── Cache warming ────────────────────────────────────────────────────────────

/**
 * Pre-populates Redis with high-traffic / mostly-static data at server startup.
 *
 * Failures are non-fatal — the server starts regardless.
 */
export async function warmCache(): Promise<void> {
  console.warn('[cacheService] Starting cache warm-up…');

  const tasks: Array<{ label: string; fn: () => Promise<void> }> = [
    {
      label: 'all breeds',
      fn: async () => {
        const result = await query(
          `SELECT DISTINCT breed FROM pets WHERE breed IS NOT NULL ORDER BY breed`,
        );
        const breeds = result.rows.map((r: { breed: string }) => r.breed);
        await set(CacheKeys.allBreeds(), breeds, CACHE_TTL.BREED);
      },
    },
    {
      label: 'top vet directory (available vets)',
      fn: async () => {
        // Warm a generic "all available vets" snapshot.
        // The in-memory vetProfiles map is the current source of truth;
        // once migrated to PostGIS this query would hit the DB.
        // We store a placeholder so the key exists and the middleware
        // can serve it without a DB round-trip.
        const result = await query(
          `SELECT id, name, specialty, credentials, accepted_insurance,
                  rating, review_count, available, lat, lng, address, phone
           FROM vets
           WHERE available = true
           ORDER BY rating DESC
           LIMIT 100`,
        ).catch(() => ({ rows: [] }));

        if (result.rows.length > 0) {
          await set(CacheKeys.vetDirectory('available=true'), result.rows, CACHE_TTL.VET);
        }
      },
    },
  ];

  const results = await Promise.allSettled(
    tasks.map(async (t) => {
      await t.fn();
      return t.label;
    }),
  );

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.warn(`[cacheService] Warmed: ${tasks[i].label}`);
    } else {
      // Non-fatal — log and continue
      console.warn(
        `[cacheService] Warm-up skipped (${tasks[i].label}):`,
        r.reason?.message ?? r.reason,
      );
    }
  });

  console.warn('[cacheService] Cache warm-up complete');
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

/** Returns current cache hit/miss/error counters. */
export function getCacheMetrics(): CacheMetrics {
  const total = hits + misses;
  const hitRate = total === 0 ? '0.00%' : `${((hits / total) * 100).toFixed(2)}%`;
  return { hits, misses, errors, hitRate };
}

/** Resets all counters (useful in tests). */
export function resetCacheMetrics(): void {
  hits = 0;
  misses = 0;
  errors = 0;
}
