import { useEffect, useState } from 'react';

import {
  networkMonitor,
  type ConnectionType,
  type NetworkStatus,
} from '../utils/networkMonitor';

/**
 * useNetworkStatus
 *
 * React hook that exposes current network connectivity status and type.
 *
 * @returns {{ isOnline: boolean; networkType: ConnectionType }}
 *   - isOnline: whether the device has an active internet connection
 *   - networkType: the active connection type ('wifi' | 'cellular' | 'unknown' | 'none')
 *
 * Re-renders on any network change (online/offline, connection type switch).
 * Cleans up the NetInfo listener automatically on unmount.
 *
 * Works on iOS and Android via @react-native-community/netinfo.
 */
export function useNetworkStatus(): {
  isOnline: boolean;
  networkType: ConnectionType;
} {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: true,
    connectionType: 'unknown',
  });

  useEffect(() => {
    // Fetch initial status so we don't flash a default
    networkMonitor.getStatus().then(setStatus).catch(() => {});

    // Subscribe to real-time status changes
    const unsubscribe = networkMonitor.onStatusChange(setStatus);
    return unsubscribe;
  }, []);

  return {
    isOnline: status.isOnline,
    networkType: status.connectionType,
  };
}

export default useNetworkStatus;
