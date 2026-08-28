import AsyncStorage from '@react-native-async-storage/async-storage';

import { SyncService } from '../syncService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

describe('backend SyncService', () => {
  let syncService: SyncService;
  const mockApiClient = {
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    get: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    syncService = new SyncService();
  });

  describe('addToQueue', () => {
    it('should add item to queue', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('[]');

      await syncService.addToQueue('pet', 'create', { id: 'pet-1', name: 'Buddy' });

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@sync_queue',
        expect.stringContaining('"type":"pet"'),
      );
    });
  });

  describe('sync', () => {
    it('should push items from queue to server', async () => {
      const queueItem = {
        id: 'q1',
        type: 'pet',
        action: 'create',
        data: { id: 'p1', name: 'Buddy' },
        timestamp: Date.now(),
        retries: 0,
      };
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([queueItem]));
      mockApiClient.post.mockResolvedValue({ data: { success: true } });

      await syncService.sync(mockApiClient);

      expect(mockApiClient.post).toHaveBeenCalledWith('/pets', queueItem.data);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('@sync_queue', '[]');
    });

    it('should handle failures and increment retries', async () => {
      const queueItem = {
        id: 'q1',
        type: 'pet',
        action: 'create',
        data: { id: 'p1', name: 'Buddy' },
        timestamp: Date.now(),
        retries: 0,
      };
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([queueItem]));
      mockApiClient.post.mockRejectedValue(new Error('Network error'));

      await syncService.sync(mockApiClient);

      const setCall = (AsyncStorage.setItem as jest.Mock).mock.calls.find(
        (call) => call[0] === '@sync_queue',
      );
      const savedQueue = JSON.parse(setCall[1]);
      expect(savedQueue[0].retries).toBe(1);
    });
  });

  describe('conflict resolution', () => {
    it('should resolve conflicts using last-write-wins', async () => {
      const conflict = {
        entityId: 'p1',
        type: 'pet',
        localData: { name: 'Local' },
        serverData: { name: 'Server' },
        localTimestamp: 200,
        serverTimestamp: 100,
      };
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([conflict]));

      await syncService.resolveConflicts('last-write-wins');

      // Local wins because localTimestamp > serverTimestamp
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@sync_queue',
        expect.stringContaining('"name":"Local"'),
      );
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('@sync_conflicts', '[]');
    });
  });
});
