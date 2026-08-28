/**
 * Express cache middleware.
 *
 * Intercepts GET requests for targeted endpoints and serves cached responses
 * from Redis when available.  On a cache miss the request passes through to
 * the route handler; the response is then captured and stored in Redis for
 * subsequent requests.
 *
 * Usage:
 *   router.get('/:id', cacheMiddleware(CacheKeys.pet, CACHE_TTL.PET), handler);
 *
 * Or use the pre-built middleware factories:
 *   router.get('/:id', petCacheMiddleware(), handler);
 *   router.get('/',    vetDirectoryCacheMiddleware(), handler);
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';

import { get, set, CacheKeys, CACHE_TTL } from '../services/cacheService';

// ─── Generic factory ──────────────────────────────────────────────────────────

/**
 * Creates a cache middleware for a given key resolver and TTL.
 *
 * @param keyResolver  Function that maps the incoming request to a Redis key.
 * @param ttl          TTL in seconds for cached responses.
 */
export function cacheMiddleware(
  keyResolver: (req: Request) => string,
  ttl: number,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      next();
      return;
    }

    const key = keyResolver(req);

    // ── Cache hit ──────────────────────────────────────────────────────────
    const cached = await get<unknown>(key);
    if (cached !== null) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    // ── Cache miss — intercept the response ────────────────────────────────
    res.setHeader('X-Cache', 'MISS');

    // Monkey-patch res.json to capture the outgoing payload
    const originalJson = res.json.bind(res);
    res.json = (body: unknown): Response => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        set(key, body, ttl).catch(() => {
          /* already logged inside set() */
        });
      }
      // Restore and call the original
      res.json = originalJson;
      return originalJson(body);
    };

    next();
  };
}

// ─── Pre-built middleware factories ──────────────────────────────────────────

/**
 * Cache middleware for `GET /api/pets/:id`.
 * Key: `petchain:cache:pet:<id>`  TTL: 1 hour
 */
export function petProfileCacheMiddleware(): RequestHandler {
  return cacheMiddleware((req) => CacheKeys.pet(String(req.params.id)), CACHE_TTL.PET);
}

/**
 * Cache middleware for `GET /api/pets?ownerId=<id>` and
 * `GET /api/pets/owner/:ownerId`.
 * Key: `petchain:cache:owner:<ownerId>:pets`  TTL: 1 hour
 */
export function petsByOwnerCacheMiddleware(): RequestHandler {
  return cacheMiddleware((req) => {
    const ownerId =
      (req.params.ownerId as string | undefined) ??
      (req.query.ownerId as string | undefined) ??
      'unknown';
    return CacheKeys.petsByOwner(ownerId);
  }, CACHE_TTL.PET);
}

/**
 * Cache middleware for `GET /api/vets/:id`.
 * Key: `petchain:cache:vet:<id>`  TTL: 6 hours
 */
export function vetProfileCacheMiddleware(): RequestHandler {
  return cacheMiddleware((req) => CacheKeys.vet(String(req.params.id)), CACHE_TTL.VET);
}

/**
 * Cache middleware for `GET /api/vets` (directory / search).
 *
 * The cache key encodes the full query string so that different search
 * parameters produce independent cache entries.
 * Key: `petchain:cache:vets:dir:<encoded-query>`  TTL: 6 hours
 */
export function vetDirectoryCacheMiddleware(): RequestHandler {
  return cacheMiddleware((req) => {
    // Stable, sorted query-string encoding so ?a=1&b=2 and ?b=2&a=1 hit
    // the same cache entry.
    const params = new URLSearchParams(
      Object.entries(req.query as Record<string, string>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return CacheKeys.vetDirectory(params || 'all');
  }, CACHE_TTL.VET);
}

/**
 * Cache middleware for breed information.
 * Key: `petchain:cache:breed:<name>`  TTL: 24 hours
 */
export function breedCacheMiddleware(): RequestHandler {
  return cacheMiddleware((req) => {
    const name = (req.params.name ?? req.query.breed ?? 'unknown') as string;
    return CacheKeys.breed(name);
  }, CACHE_TTL.BREED);
}

/**
 * Bypass helper — skips caching for a specific request.
 * Attach as middleware before the cache middleware to opt out.
 */
export function noCache(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Cache', 'BYPASS');
    next();
  };
}
