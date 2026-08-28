import { CacheManager } from '../../../backend/services/cacheManager';

describe('CacheManager', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager({ ttl: 100, maxSize: 3 });
  });

  it('should store and retrieve values', () => {
    cacheManager.set('key1', 'value1');
    expect(cacheManager.get('key1')).toBe('value1');
  });

  it('should return undefined for non-existent keys', () => {
    expect(cacheManager.get('nonexistent')).toBeUndefined();
  });

  it('should expire entries after TTL', (done) => {
    cacheManager.set('key1', 'value1', 50);
    setTimeout(() => {
      expect(cacheManager.get('key1')).toBeUndefined();
      done();
    }, 100);
  });

  it('should respect maxSize and evict oldest entry', () => {
    cacheManager.set('key1', 'value1');
    cacheManager.set('key2', 'value2');
    cacheManager.set('key3', 'value3');
    cacheManager.set('key4', 'value4'); // Should evict key1

    expect(cacheManager.get('key1')).toBeUndefined();
    expect(cacheManager.get('key2')).toBe('value2');
    expect(cacheManager.get('key3')).toBe('value3');
    expect(cacheManager.get('key4')).toBe('value4');
  });

  it('should invalidate specific key', () => {
    cacheManager.set('key1', 'value1');
    cacheManager.invalidate('key1');
    expect(cacheManager.get('key1')).toBeUndefined();
  });

  it('should invalidate keys matching a pattern', () => {
    cacheManager.set('user:1', 'data1');
    cacheManager.set('user:2', 'data2');
    cacheManager.set('pet:1', 'data3');

    cacheManager.invalidatePattern(/^user:/);

    expect(cacheManager.get('user:1')).toBeUndefined();
    expect(cacheManager.get('user:2')).toBeUndefined();
    expect(cacheManager.get('pet:1')).toBe('data3');
  });

  it('should warm the cache', async () => {
    const loader = jest.fn().mockResolvedValue('warmed-data');
    await cacheManager.warm([{ key: 'warm-key', loader }]);

    expect(loader).toHaveBeenCalled();
    expect(cacheManager.get('warm-key')).toBe('warmed-data');
  });

  it('should not throw and should skip the entry when a warm loader rejects', async () => {
    const failingLoader = jest.fn().mockRejectedValue(new Error('load failed'));
    await expect(
      cacheManager.warm([{ key: 'broken-key', loader: failingLoader }]),
    ).resolves.toBeUndefined();

    expect(cacheManager.get('broken-key')).toBeUndefined();
  });

  it('should overwrite an existing value for the same key', () => {
    cacheManager.set('key1', 'value1');
    cacheManager.set('key1', 'value1-updated');

    expect(cacheManager.get('key1')).toBe('value1-updated');
    expect(cacheManager.size).toBe(1);
  });

  it('should clear all entries', () => {
    cacheManager.set('key1', 'value1');
    cacheManager.set('key2', 'value2');
    cacheManager.clear();
    expect(cacheManager.size).toBe(0);
  });
});
