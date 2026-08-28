import NetInfo, { type NetInfoState, type NetInfoStateType } from '@react-native-community/netinfo';

type NetworkCallback = (isOnline: boolean) => void;
type SyncCallback = () => Promise<void>;

export type ConnectionType = 'wifi' | 'cellular' | 'unknown' | 'none';

export interface NetworkStatus {
  isOnline: boolean;
  connectionType: ConnectionType;
}

class NetworkMonitor {
  private unsubscribe: (() => void) | null = null;
  private callbacks: NetworkCallback[] = [];
  private statusCallbacks: Array<(status: NetworkStatus) => void> = [];
  private syncCallback: SyncCallback | null = null;
  private isCurrentlyOnline = false;
  private currentConnectionType: ConnectionType = 'unknown';

  startNetworkMonitoring(): void {
    this.unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const wasOnline = this.isCurrentlyOnline;
      this.isCurrentlyOnline = state.isConnected ?? false;
      this.currentConnectionType = this.resolveConnectionType(state.type);

      const status: NetworkStatus = {
        isOnline: this.isCurrentlyOnline,
        connectionType: this.currentConnectionType,
      };

      // Trigger sync when coming back online
      if (!wasOnline && this.isCurrentlyOnline && this.syncCallback) {
        this.syncCallback().catch(console.error);
      }

      this.callbacks.forEach((cb) => cb(this.isCurrentlyOnline));
      this.statusCallbacks.forEach((cb) => cb(status));
    });
  }

  stopNetworkMonitoring(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.callbacks = [];
    this.statusCallbacks = [];
  }

  async isOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return state.isConnected ?? false;
  }

  async getNetworkType(): Promise<NetInfoStateType> {
    const state = await NetInfo.fetch();
    return state.type;
  }

  async getStatus(): Promise<NetworkStatus> {
    const state = await NetInfo.fetch();
    return {
      isOnline: state.isConnected ?? false,
      connectionType: this.resolveConnectionType(state.type),
    };
  }

  onNetworkChange(callback: NetworkCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((cb) => cb !== callback);
    };
  }

  onStatusChange(callback: (status: NetworkStatus) => void): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((cb) => cb !== callback);
    };
  }

  setSyncCallback(callback: SyncCallback): void {
    this.syncCallback = callback;
  }

  async getNetworkQuality(): Promise<ConnectionType> {
    const state = await NetInfo.fetch();
    return this.resolveConnectionType(state.type);
  }

  private resolveConnectionType(type: NetInfoStateType): ConnectionType {
    if (type === 'wifi' || type === 'ethernet') return 'wifi';
    if (type === 'cellular') return 'cellular';
    if (type === 'none' || type === 'unknown') return type as ConnectionType;
    return 'unknown';
  }
}

export const networkMonitor = new NetworkMonitor();
export const startNetworkMonitoring = () => networkMonitor.startNetworkMonitoring();

// Convenience exports
export const stopNetworkMonitoring = () => networkMonitor.stopNetworkMonitoring();
export const isOnline = () => networkMonitor.isOnline();
export const getNetworkType = () => networkMonitor.getNetworkType();
export const getStatus = () => networkMonitor.getStatus();
export const onNetworkChange = (callback: NetworkCallback) =>
  networkMonitor.onNetworkChange(callback);
export const onStatusChange = (callback: (status: NetworkStatus) => void) =>
  networkMonitor.onStatusChange(callback);
export const setSyncCallback = (callback: SyncCallback) => networkMonitor.setSyncCallback(callback);
export const getNetworkQuality = () => networkMonitor.getNetworkQuality();
