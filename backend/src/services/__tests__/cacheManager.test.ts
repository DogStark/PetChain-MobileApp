import { PetCacheManager } from '../cacheManager';

describe('CacheManager (via PetCacheManager)', () => {
  let cache: PetCacheManager;

  beforeEach(() => {
    cache = new PetCacheManager();
  });

  describe('cacheData / getCachedData', () => {
    it('should store and retrieve a value', async () => {
      await cache.cacheData('key1', { foo: 'bar' });
      await expect(cache.getCachedData('key1')).resolves.toEqual({ foo: 'bar' });
    });

    it('should return null for a cache miss', async () => {
      await expect(cache.getCachedData('missing-key')).resolves.toBeNull();
    });

    it('should overwrite an existing value for the same key', async () => {
      await cache.cacheData('key1', 'value1');
      await cache.cacheData('key1', 'value1-updated');

      await expect(cache.getCachedData('key1')).resolves.toBe('value1-updated');
    });
  });

  describe('TTL expiration', () => {
    it('should return the value before it expires', async () => {
      await cache.cacheData('short-lived', 'still-fresh', 100);
      await expect(cache.getCachedData('short-lived')).resolves.toBe('still-fresh');
    });

    it('should expire and remove an entry after its TTL elapses', async () => {
      await cache.cacheData('short-lived', 'will-expire', 20);

      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(cache.getCachedData('short-lived')).resolves.toBeNull();
    });

    it('should fall back to the default TTL when none is provided', async () => {
      const shortDefaultCache = new PetCacheManager(50 * 1024 * 1024, 20);
      await shortDefaultCache.cacheData('key1', 'value1');

      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(shortDefaultCache.getCachedData('key1')).resolves.toBeNull();
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate a specific key', async () => {
      await cache.cacheData('key1', 'value1');
      await cache.invalidateCache('key1');

      await expect(cache.getCachedData('key1')).resolves.toBeNull();
    });

    it('should invalidate keys matching a pattern and leave others intact', async () => {
      await cache.cacheData('user:1', 'data1');
      await cache.cacheData('user:2', 'data2');
      await cache.cacheData('pet:1', 'data3');

      cache.invalidatePattern(/^user:/);

      await expect(cache.getCachedData('user:1')).resolves.toBeNull();
      await expect(cache.getCachedData('user:2')).resolves.toBeNull();
      await expect(cache.getCachedData('pet:1')).resolves.toBe('data3');
    });

    it('should clear expired entries while keeping valid ones', async () => {
      await cache.cacheData('expiring', 'gone-soon', 20);
      await cache.cacheData('persisting', 'still-here', 60_000);

      await new Promise((resolve) => setTimeout(resolve, 50));
      await cache.clearExpiredCache();

      await expect(cache.getCachedData('expiring')).resolves.toBeNull();
      await expect(cache.getCachedData('persisting')).resolves.toBe('still-here');
    });

    it('should clear all entries', async () => {
      await cache.cacheData('key1', 'value1');
      await cache.cacheData('key2', 'value2');

      await cache.clearCache();

      const stats = await cache.getCacheSize();
      expect(stats.itemCount).toBe(0);
      await expect(cache.getCachedData('key1')).resolves.toBeNull();
    });
  });

  describe('getCacheSize', () => {
    it('should report the number of cached items and an estimated byte size', async () => {
      await cache.cacheData('key1', 'value1');
      await cache.cacheData('key2', 'value2');

      const stats = await cache.getCacheSize();

      expect(stats.itemCount).toBe(2);
      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe('cache size management / eviction', () => {
    it('should evict entries once the cache exceeds its configured max size', async () => {
      const maxSize = 250;
      const tinyCache = new PetCacheManager(maxSize, 60_000);

      await tinyCache.cachePet('1', 'x');
      await tinyCache.cachePet('2', 'x');
      await tinyCache.cachePet('3', 'x');
      await tinyCache.cachePet('4', 'x');

      const stats = await tinyCache.getCacheSize();
      expect(stats.itemCount).toBeLessThan(4);
      expect(stats.size).toBeLessThanOrEqual(maxSize);
    });
  });

  describe('warmCache', () => {
    it('should populate the cache from successful loaders', async () => {
      const loader = jest.fn().mockResolvedValue('warmed-data');
      await cache.warmCache([{ key: 'warm-key', loader }]);

      expect(loader).toHaveBeenCalled();
      await expect(cache.getCachedData('warm-key')).resolves.toBe('warmed-data');
    });

    it('should not throw and should skip entries whose loader rejects', async () => {
      const failingLoader = jest.fn().mockRejectedValue(new Error('load failed'));

      await expect(
        cache.warmCache([{ key: 'broken-key', loader: failingLoader }]),
      ).resolves.toBeUndefined();

      await expect(cache.getCachedData('broken-key')).resolves.toBeNull();
    });
  });

  describe('resolveConflict', () => {
    it('should return remote data and cache it when there is no local entry', async () => {
      const resolved = await cache.syncPetData('1', { name: 'remote-pet' });
      expect(resolved).toEqual({ name: 'remote-pet' });
      await expect(cache.getCachedPet('1')).resolves.toEqual({ name: 'remote-pet' });
    });

    it('should prefer the newer (remote) data when it is more recent than the cached copy', async () => {
      await cache.cachePet('1', { name: 'local-pet' });
      // Ensure the clock advances past the cached entry's timestamp before resolving.
      await new Promise((resolve) => setTimeout(resolve, 5));

      const resolved = await cache.syncPetData('1', { name: 'remote-pet' });

      expect(resolved).toEqual({ name: 'remote-pet' });
      await expect(cache.getCachedPet('1')).resolves.toEqual({ name: 'remote-pet' });
    });

    it('should keep the local data when it is newer than the incoming remote timestamp', async () => {
      await cache.cachePet('1', { name: 'local-pet' });

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
      try {
        const resolved = await cache.syncPetData('1', { name: 'remote-pet' });
        expect(resolved).toEqual({ name: 'local-pet' });
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  describe('PetCacheManager', () => {
    it('should cache and retrieve a pet list', async () => {
      const pets = [{ id: '1' }, { id: '2' }];
      await cache.cachePetList(pets);

      await expect(cache.getCachedPetList()).resolves.toEqual(pets);
    });

    it('should return null when no pet list is cached', async () => {
      await expect(cache.getCachedPetList()).resolves.toBeNull();
    });

    it('should invalidate both the pet entry and the pet list on invalidatePet', async () => {
      await cache.cachePet('1', { id: '1' });
      await cache.cachePetList([{ id: '1' }]);

      await cache.invalidatePet('1');

      await expect(cache.getCachedPet('1')).resolves.toBeNull();
      await expect(cache.getCachedPetList()).resolves.toBeNull();
    });

    it('should return the same singleton instance from getInstance', () => {
      const instanceA = PetCacheManager.getInstance();
      const instanceB = PetCacheManager.getInstance();

      expect(instanceA).toBe(instanceB);
    });
  });
});
