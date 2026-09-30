const mockStore: Record<string, string> = {};
let mockStatusListener:
  | ((status: { isOnline: boolean; connectionType: string; isConnectionExpensive: boolean }) => void)
  | null = null;
let mockNetworkStatus = {
  isOnline: true,
  connectionType: 'wifi',
  isConnectionExpensive: false,
};

jest.mock('../localDB', () => ({
  executeSql: jest.fn().mockResolvedValue({ changes: 1 }),
  getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore[key] = value;
  }),
}));
jest.mock('../apiClient', () => ({
  __esModule: true,
  default: { put: jest.fn(), head: jest.fn(), get: jest.fn(), post: jest.fn() },
}));
jest.mock('../notificationService', () => ({ sendAlertNotification: jest.fn() }));
jest.mock('../syncService', () => ({
  __esModule: true,
  default: {
    enqueue: jest.fn(),
    getStatus: jest.fn().mockResolvedValue({
      pendingCount: 0,
      isSyncing: false,
      lastSync: null,
      failedCount: 0,
    }),
    onStatusChange: jest.fn(),
  },
}));
jest.mock('../../utils/networkMonitor', () => ({
  networkMonitor: {
    getStatus: jest.fn(async () => mockNetworkStatus),
    isOnline: jest.fn(async () => mockNetworkStatus.isOnline),
    onStatusChange: jest.fn((listener) => {
      mockStatusListener = listener;
      return jest.fn();
    }),
    setSyncCallback: jest.fn(),
    startNetworkMonitoring: jest.fn(),
  },
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    getAllSync: jest.fn(() => []),
    runSync: jest.fn(),
  })),
}));

import apiClient from '../apiClient';
import offlineQueue from '../offlineQueue';

const mockPut = apiClient.put as jest.Mock;

describe('offline queue retry policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockStore).forEach((key) => delete mockStore[key]);
    mockStatusListener = null;
    mockNetworkStatus = {
      isOnline: true,
      connectionType: 'wifi',
      isConnectionExpensive: false,
    };
    jest.useFakeTimers();
  });

  afterEach(() => jest.useRealTimers());

  const mutation = {
    id: 'pet_100',
    type: 'pet',
    action: 'update',
    data: { id: 'pet-1', name: 'Milo' },
    timestamp: 100,
    retries: 0,
  };

  it('persists bounded exponential retry metadata and a stable idempotency key', async () => {
    mockStore['@offline_queue'] = JSON.stringify([mutation]);
    mockPut.mockRejectedValueOnce(new Error('network unavailable'));

    await offlineQueue.processQueue();

    const queued = JSON.parse(mockStore['@offline_queue'])[0];
    expect(queued.retries).toBe(1);
    expect(queued.nextRetryAt).toBeGreaterThan(Date.now());
    expect(queued.lastError).toBe('network unavailable');
    expect(mockPut.mock.calls[0][2].headers['Idempotency-Key']).toBe('offline-pet_100');
  });

  it('does not upload on configured expensive networks, then resumes on eligible transition', async () => {
    mockNetworkStatus = {
      isOnline: false,
      connectionType: 'cellular',
      isConnectionExpensive: true,
    };
    mockStore['@offline_queue'] = JSON.stringify([mutation]);
    mockPut.mockResolvedValue({ headers: {} });
    offlineQueue.configure({ pauseOnExpensiveNetwork: true });
    await offlineQueue.initialize();

    mockNetworkStatus = {
      isOnline: true,
      connectionType: 'cellular',
      isConnectionExpensive: true,
    };
    await mockStatusListener?.(mockNetworkStatus);
    expect(mockPut).not.toHaveBeenCalled();

    mockNetworkStatus = {
      isOnline: true,
      connectionType: 'wifi',
      isConnectionExpensive: false,
    };
    await mockStatusListener?.(mockNetworkStatus);

    expect(mockPut).toHaveBeenCalledTimes(1);
  });

  it('keeps mutations visible after the bounded retry limit', async () => {
    mockStore['@offline_queue'] = JSON.stringify([
      { ...mutation, retries: 5, lastError: 'still offline' },
    ]);
    await offlineQueue.processQueue();

    expect(mockPut).not.toHaveBeenCalled();
    await expect(offlineQueue.getStatus()).resolves.toMatchObject({
      pendingCount: 1,
      exhaustedCount: 1,
      nextRetryAt: null,
    });
  });
});