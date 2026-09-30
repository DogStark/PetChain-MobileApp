import { act, renderHook } from '@testing-library/react-native';

import { useNetworkStatus } from '../useNetworkStatus';
import { networkMonitor } from '../../utils/networkMonitor';

jest.mock('../../utils/networkMonitor', () => ({
  networkMonitor: {
    getStatus: jest.fn(),
    onStatusChange: jest.fn(),
  },
}));

describe('useNetworkStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns default values before initial fetch resolves', () => {
    (networkMonitor.getStatus as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    (networkMonitor.onStatusChange as jest.Mock).mockReturnValue(jest.fn());

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current).toEqual({
      isOnline: true,
      networkType: 'unknown',
    });
  });

  it('fetches and returns initial network status', async () => {
    (networkMonitor.getStatus as jest.Mock).mockResolvedValue({
      isOnline: true,
      connectionType: 'wifi',
    });
    (networkMonitor.onStatusChange as jest.Mock).mockReturnValue(jest.fn());

    const { result } = renderHook(() => useNetworkStatus());

    // Wait for the async getStatus to resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(networkMonitor.getStatus).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({
      isOnline: true,
      networkType: 'wifi',
    });
  });

  it('re-renders when network status changes', () => {
    let statusCallback: (status: { isOnline: boolean; connectionType: string }) => void;
    (networkMonitor.getStatus as jest.Mock).mockResolvedValue({
      isOnline: true,
      connectionType: 'wifi',
    });
    (networkMonitor.onStatusChange as jest.Mock).mockImplementation(
      (cb: (status: { isOnline: boolean; connectionType: string }) => void) => {
        statusCallback = cb;
        return jest.fn();
      },
    );

    const { result } = renderHook(() => useNetworkStatus());

    // Simulate going offline
    act(() => {
      statusCallback!({ isOnline: false, connectionType: 'none' });
    });

    expect(result.current).toEqual({
      isOnline: false,
      networkType: 'none',
    });
  });

  it('re-renders when connection type changes', () => {
    let statusCallback: (status: { isOnline: boolean; connectionType: string }) => void;
    (networkMonitor.getStatus as jest.Mock).mockResolvedValue({
      isOnline: true,
      connectionType: 'wifi',
    });
    (networkMonitor.onStatusChange as jest.Mock).mockImplementation(
      (cb: (status: { isOnline: boolean; connectionType: string }) => void) => {
        statusCallback = cb;
        return jest.fn();
      },
    );

    const { result } = renderHook(() => useNetworkStatus());

    // Simulate switching to cellular
    act(() => {
      statusCallback!({ isOnline: true, connectionType: 'cellular' });
    });

    expect(result.current).toEqual({
      isOnline: true,
      networkType: 'cellular',
    });
  });

  it('cleans up listener on unmount', () => {
    const unsubscribeMock = jest.fn();
    (networkMonitor.getStatus as jest.Mock).mockResolvedValue({
      isOnline: true,
      connectionType: 'wifi',
    });
    (networkMonitor.onStatusChange as jest.Mock).mockReturnValue(unsubscribeMock);

    const { unmount } = renderHook(() => useNetworkStatus());

    unmount();

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('still works when getStatus fails (defaults kept)', async () => {
    (networkMonitor.getStatus as jest.Mock).mockRejectedValue(new Error('Network error'));
    (networkMonitor.onStatusChange as jest.Mock).mockReturnValue(jest.fn());

    const { result } = renderHook(() => useNetworkStatus());

    await act(async () => {
      await Promise.resolve();
    });

    // Should keep the default values since getStatus failed
    expect(result.current).toEqual({
      isOnline: true,
      networkType: 'unknown',
    });
  });
});
