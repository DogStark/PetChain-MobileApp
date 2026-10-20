import { create } from 'zustand';

export type StellarNetwork = 'public' | 'testnet' | 'futurenet';

export interface WalletIdentity {
  account: string | null;
  network: StellarNetwork | null;
}

export interface ServerConfirmedPermissions {
  canSign: boolean;
  account: string | null;
  network: StellarNetwork | null;
  confirmedAt: number | null;
}

export interface WalletHealthState {
  connectedAccount: string | null;
  selectedNetwork: StellarNetwork | null;
  lastVerifiedAt: number | null;
  serverPermissions: ServerConfirmedPermissions | null;
  isVerifying: boolean;
  isOffline: boolean;
  error: string | null;
  setConnectedWallet: (account: string | null, network: StellarNetwork | null) => void;
  setOffline: (offline: boolean) => void;
  beginVerification: () => void;
  applyServerPermissions: (permissions: ServerConfirmedPermissions) => void;
  failVerification: (message: string) => void;
  reset: () => void;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

const initialState = {
  connectedAccount: null as string | null,
  selectedNetwork: null as StellarNetwork | null,
  lastVerifiedAt: null as number | null,
  serverPermissions: null as ServerConfirmedPermissions | null,
  isVerifying: false,
  isOffline: false,
  error: null as string | null,
};

export const useWalletHealthStore = create<WalletHealthState>((set) => ({
  ...initialState,
  setConnectedWallet: (account, network) =>
    set((state) => {
      const identityChanged =
        state.connectedAccount !== account || state.selectedNetwork !== network;
      return {
        connectedAccount: account,
        selectedNetwork: network,
        // Identity change invalidates prior verification until the server re-confirms.
        lastVerifiedAt: identityChanged ? null : state.lastVerifiedAt,
        serverPermissions: identityChanged ? null : state.serverPermissions,
        error: null,
      };
    }),
  setOffline: (offline) => set({ isOffline: offline }),
  beginVerification: () => set({ isVerifying: true, error: null }),
  applyServerPermissions: (permissions) =>
    set({
      isVerifying: false,
      error: null,
      serverPermissions: permissions,
      lastVerifiedAt: permissions.confirmedAt,
    }),
  failVerification: (message) =>
    set({ isVerifying: false, error: message }),
  reset: () => set({ ...initialState }),
}));

export interface WalletHealthSnapshot {
  connectedAccount: string | null;
  selectedNetwork: StellarNetwork | null;
  lastVerifiedAt: number | null;
  isStale: boolean;
  canSign: boolean;
  reason: string | null;
}

/**
 * Derives the wallet health snapshot used by the health/network screen and by
 * signing guards. Signing is blocked whenever the server-confirmed identity is
 * missing, mismatched, or older than the staleness threshold.
 */
export function selectWalletHealth(
  state: WalletHealthState,
  now: number = Date.now(),
): WalletHealthSnapshot {
  const { connectedAccount, selectedNetwork, lastVerifiedAt, serverPermissions } = state;

  const base = {
    connectedAccount,
    selectedNetwork,
    lastVerifiedAt,
  };

  if (!connectedAccount || !selectedNetwork) {
    return { ...base, isStale: false, canSign: false, reason: 'No wallet connected' };
  }

  if (!serverPermissions || !lastVerifiedAt) {
    return {
      ...base,
      isStale: true,
      canSign: false,
      reason: 'Wallet identity not yet verified by server',
    };
  }

  if (
    serverPermissions.account !== connectedAccount ||
    serverPermissions.network !== selectedNetwork
  ) {
    return {
      ...base,
      isStale: true,
      canSign: false,
      reason: 'Server-confirmed identity does not match connected wallet',
    };
  }

  const isStale = now - lastVerifiedAt > STALE_THRESHOLD_MS;
  if (isStale) {
    return {
      ...base,
      isStale: true,
      canSign: false,
      reason: 'Wallet verification is stale',
    };
  }

  if (!serverPermissions.canSign) {
    return {
      ...base,
      isStale: false,
      canSign: false,
      reason: 'Server has not granted signing permission',
    };
  }

  return { ...base, isStale: false, canSign: true, reason: null };
}

export const WALLET_STALE_THRESHOLD_MS = STALE_THRESHOLD_MS;
