import NetInfo from '@react-native-community/netinfo';

import { networkMonitor } from '../networkMonitor';

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
  fetch: jest.fn(),
}));

describe('networkMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    networkMonitor.stopNetworkMonitoring();
  });

  it('should start monitoring and handle state changes', () => {
    let callback: any;
    (NetInfo.addEventListener as jest.Mock).mockImplementation((cb) => {
      callback = cb;
      return jest.fn();
    });

    const networkCallback = jest.fn();
    networkMonitor.onNetworkChange(networkCallback);
    networkMonitor.startNetworkMonitoring();

    // Simulate coming online
    callback({ isConnected: true, type: 'wifi' });
    expect(networkCallback).toHaveBeenCalledWith(true);

    // Simulate going offline
    callback({ isConnected: false, type: 'none' });
    expect(networkCallback).toHaveBeenCalledWith(false);
  });

  it('should trigger sync callback when coming back online', async () => {
    let callback: any;
    (NetInfo.addEventListener as jest.Mock).mockImplementation((cb) => {
      callback = cb;
      return jest.fn();
    });

    const syncCallback = jest.fn().mockResolvedValue(undefined);
    networkMonitor.setSyncCallback(syncCallback);
    networkMonitor.startNetworkMonitoring();

    // Start offline
    callback({ isConnected: false, type: 'none' });
    expect(syncCallback).not.toHaveBeenCalled();

    // Go online
    callback({ isConnected: true, type: 'wifi' });
    expect(syncCallback).toHaveBeenCalled();
  });

  it('should fetch current status', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true, type: 'cellular' });

    const status = await networkMonitor.getStatus();
    expect(status.isOnline).toBe(true);
    expect(status.connectionType).toBe('cellular');
  });

  it('should unsubscribe and clear callbacks on stop', () => {
    const unsubscribeMock = jest.fn();
    (NetInfo.addEventListener as jest.Mock).mockReturnValue(unsubscribeMock);

    networkMonitor.startNetworkMonitoring();
    networkMonitor.stopNetworkMonitoring();

    expect(unsubscribeMock).toHaveBeenCalled();
  });
});
