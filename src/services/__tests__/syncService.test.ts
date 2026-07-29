import apiClient from '../apiClient';
import { getItem, setItem } from '../localDB';
import { SyncService } from '../syncService';
import { networkMonitor } from '../../utils/networkMonitor';

jest.mock('../localDB', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../apiClient');
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

jest.mock('../../utils/networkMonitor', () => ({
  networkMonitor: {
    isOnline: jest.fn(),
  },
}));

const mockedNetworkMonitor = networkMonitor as jest.Mocked<typeof networkMonitor>;

describe('SyncService', () => {
  let syncService: SyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    syncService = new SyncService();
    mockedNetworkMonitor.isOnline.mockResolvedValue(true);
  });

  describe('enqueue', () => {
    it('should add item to queue', async () => {
      (getItem as jest.Mock).mockResolvedValue('[]');

      await syncService.enqueue('pet', 'create', { id: 'pet-1', name: 'Buddy' });

      expect(setItem).toHaveBeenCalledWith('@sync_queue', expect.stringContaining('"type":"pet"'));
    });

    it('should deduplicate existing items', async () => {
      const existingItem = {
        id: 'q1',
        type: 'pet',
        action: 'update',
        data: { id: 'p1', name: 'Old' },
      };
      (getItem as jest.Mock).mockResolvedValue(JSON.stringify([existingItem]));

      await syncService.enqueue('pet', 'update', { id: 'p1', name: 'New' });

      const setCall = (setItem as jest.Mock).mock.calls[0];
      const savedQueue = JSON.parse(setCall[1]);
      expect(savedQueue).toHaveLength(1);
      expect(savedQueue[0].data.name).toBe('New');
    });
  });

  describe('push', () => {
    it('should process queued items and call API', async () => {
      (getItem as jest.Mock).mockResolvedValue(
        JSON.stringify([
          {
            id: '1',
            type: 'pet',
            action: 'create',
            data: { id: 'p1', name: 'Buddy' },
            timestamp: Date.now(),
            retries: 0,
          },
        ]),
      );

      mockedApiClient.post.mockResolvedValue({ data: {} });

      await syncService.push();

      expect(mockedApiClient.post).toHaveBeenCalledWith('/pets', { id: 'p1', name: 'Buddy' });
    });

    it('should not push when offline', async () => {
      mockedNetworkMonitor.isOnline.mockResolvedValue(false);
      (getItem as jest.Mock).mockResolvedValue(
        JSON.stringify([
          {
            id: '1',
            type: 'pet',
            action: 'create',
            data: { id: 'p1' },
            timestamp: Date.now(),
            retries: 0,
          },
        ]),
      );

      await syncService.push();

      expect(mockedApiClient.post).not.toHaveBeenCalled();
    });

    it('should retry failed items up to max retries', async () => {
      const queue = [
        {
          id: '1',
          type: 'pet',
          action: 'create',
          data: { id: 'p1' },
          timestamp: Date.now(),
          retries: 0,
        },
      ];
      (getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

      mockedApiClient.post.mockRejectedValue(new Error('network error'));

      await syncService.push();

      expect(mockedApiClient.post).toHaveBeenCalledTimes(1);
      const setCall = (setItem as jest.Mock).mock.calls[0];
      const remaining = JSON.parse(setCall[1]);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].retries).toBe(1);
    });

    it('should drop items after max retries exceeded', async () => {
      const queue = [
        {
          id: '1',
          type: 'pet',
          action: 'create',
          data: { id: 'p1' },
          timestamp: Date.now(),
          retries: 3,
        },
      ];
      (getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

      mockedApiClient.post.mockRejectedValue(new Error('network error'));

      await syncService.push();

      const setCall = (setItem as jest.Mock).mock.calls[0];
      const remaining = JSON.parse(setCall[1]);
      expect(remaining).toHaveLength(0);
    });
  });

  describe('conflict resolution', () => {
    it('should choose server data when server timestamp is newer', async () => {
      const local = { id: 'p1', name: 'Local', updatedAt: 100 };
      const server = { id: 'p1', name: 'Server', updatedAt: 200 };

      const result = await syncService.resolveConflict('pet', local, server, 'last-write-wins');

      expect(result).toEqual(server);
    });

    it('should choose local data when local timestamp is newer', async () => {
      const local = { id: 'p1', name: 'Local', updatedAt: 300 };
      const server = { id: 'p1', name: 'Server', updatedAt: 200 };

      const result = await syncService.resolveConflict('pet', local, server, 'last-write-wins');

      expect(result).toEqual(local);
    });

    it('should default to server data for manual strategy', async () => {
      const local = { id: 'p1', name: 'Local', updatedAt: 300 };
      const server = { id: 'p1', name: 'Server', updatedAt: 200 };

      const result = await syncService.resolveConflict('pet', local, server, 'manual');

      expect(result).toEqual(server);
    });
  });

  describe('status management', () => {
    it('should notify listeners on status change', async () => {
      const listener = jest.fn();
      syncService.onStatusChange(listener);

      (getItem as jest.Mock).mockResolvedValue('[]');
      await syncService.enqueue('pet', 'create', { id: '1' });

      expect(listener).toHaveBeenCalled();
      const status = listener.mock.calls[0][0];
      expect(status.pendingCount).toBe(1);
    });
  });
});
