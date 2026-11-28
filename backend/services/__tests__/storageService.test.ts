import AsyncStorage from '@react-native-async-storage/async-storage';

import { get, set, remove, clear, getMultiple, setMultiple, removeMultiple, getAllKeys } from '../storageService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  getAllKeys: jest.fn(),
  multiGet: jest.fn(),
  multiSet: jest.fn(),
  multiRemove: jest.fn(),
}));

describe('backend storageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('should return parsed value', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolved(JSON.stringify({ a: 1 }));
      const result = await get<{ a: number }>('key');
      expect(result).toEqual({ a: 1 });
    });

    it('should return null if not found', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolved(null);
      const result = await get('key');
      expect(result).toBeNull();
    });

    it('should throw StorageError on error', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejected(new Error('error'));
      await expect(get('key')).rejects.toThrow('Failed to get item');
    });
  });

  describe('set', () => {
    it('should set serialized value', async () => {
      await set('key', { a: 1 });
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('key', JSON.stringify({ a: 1 }));
    });
  });

  describe('remove', () => {
    it('should remove item', async () => {
      await remove('key');
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('key');
    });
  });

  describe('clear', () => {
    it('should clear offline data but preserve unsynchronized drafts', async () => {
      (AsyncStorage.getAllKeys as jest.Mock).mockResolved(['@media:pet:1', '@drafts:pet:1']);
      (AsyncStorage.multiGet as jest.Mock).mockResolved([
        ['@media:pet:1', 'x'],
        ['@drafts:pet:1', 'y'],
      ]);

      await clear();

      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(['@media:pet:1']);
      expect(AsyncStorage.clear).not.toHaveBeenCalled();
    });

    it('should fall back to full clear when key enumeration fails', async () => {
      (AsyncStorage.getAllKeys as jest.Mock).mockRejected(new Error('boom'));

      await clear();

      expect(AsyncStorage.clear).toHaveBeenCalled();
    });
  });

  describe('multi operations', () => {
    it('should get multiple items', async () => {
      (AsyncStorage.multiGet as jest.Mock).mockResolved([
        ['k1', JSON.stringify(1)],
        ['k2', null],
      ]);
      const result = await getMultiple<number>(['k1', 'k2']);
      expect(result).toEqual({ k1: 1, k2: null });
    });

    it('should set multiple items', async () => {
      await setMultiple({ k1: 1, k2: 2 });
      expect(AsyncStorage.multiSet).toHaveBeenCalledWith([
        ['k1', JSON.stringify(1)],
        ['k2', JSON.stringify(2)],
      ]);
    });

    it('should remove multiple items', async () => {
      await removeMultiple(['k1', 'k2']);
      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(['k1', 'k2']);
    });

    it('should list all keys', async () => {
      (AsyncStorage.getAllKeys as jest.Mock).mockResolved(['a:', 'b:']);
      await expect(getAllKeys()).resolves.toEqual(['a:', 'b:']);
    });
  });
});
