import AsyncStorage from '@react-native-async-storage/async-storage';

import { StorageError, clearAll, getItem, removeItem, setItem } from '../storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getItem', () => {
    it('should return parsed JSON for existing key', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify({ name: 'Buddy' }));

      const result = await getItem<{ name: string }>('@pet');

      expect(result).toEqual({ name: 'Buddy' });
      expect(mockedAsyncStorage.getItem).toHaveBeenCalledWith('@pet');
    });

    it('should return null for missing key', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue(null);

      const result = await getItem<unknown>('@missing');

      expect(result).toBeNull();
      expect(mockedAsyncStorage.getItem).toHaveBeenCalledWith('@missing');
    });

    it('should throw StorageError on parse failure', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('not-json');

      await expect(getItem<unknown>('@bad')).rejects.toThrow(StorageError);
      await expect(getItem<unknown>('@bad')).rejects.toThrow(
        'Failed to read key "@bad" from storage',
      );
    });

    it('should throw StorageError on AsyncStorage failure', async () => {
      mockedAsyncStorage.getItem.mockRejectedValueOnce(new Error('storage down'));

      await expect(getItem<unknown>('@error')).rejects.toThrow(StorageError);
    });
  });

  describe('setItem', () => {
    it('should serialise value and store it', async () => {
      mockedAsyncStorage.setItem.mockResolvedValue(undefined);

      await setItem('@user', { id: '1', name: 'Alice' });

      expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(
        '@user',
        JSON.stringify({ id: '1', name: 'Alice' }),
      );
    });

    it('should throw StorageError on serialisation failure', async () => {
      const circular = { a: {} as any };
      (circular as any).a.self = circular;

      await expect(setItem('@bad', circular)).rejects.toThrow(StorageError);
      expect(mockedAsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it('should throw StorageError on AsyncStorage failure', async () => {
      mockedAsyncStorage.setItem.mockRejectedValueOnce(new Error('write failed'));

      await expect(setItem('@user', { id: '1' })).rejects.toThrow(StorageError);
    });
  });

  describe('removeItem', () => {
    it('should delete key from AsyncStorage', async () => {
      mockedAsyncStorage.removeItem.mockResolvedValue(undefined);

      await removeItem('@temp');

      expect(mockedAsyncStorage.removeItem).toHaveBeenCalledWith('@temp');
    });

    it('should throw StorageError on failure', async () => {
      mockedAsyncStorage.removeItem.mockRejectedValueOnce(new Error('remove failed'));

      await expect(removeItem('@temp')).rejects.toThrow(StorageError);
    });
  });

  describe('clearAll', () => {
    it('should wipe all AsyncStorage data', async () => {
      mockedAsyncStorage.clear.mockResolvedValue(undefined);

      await clearAll();

      expect(mockedAsyncStorage.clear).toHaveBeenCalled();
    });

    it('should throw StorageError on failure', async () => {
      mockedAsyncStorage.clear.mockRejectedValueOnce(new Error('clear failed'));

      await expect(clearAll()).rejects.toThrow(StorageError);
      await expect(clearAll()).rejects.toThrow('Failed to clear AsyncStorage');
    });
  });
});
