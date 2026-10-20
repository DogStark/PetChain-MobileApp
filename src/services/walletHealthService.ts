import { Platform } from 'react-native';

export type StellarNetwork = 'public' | 'testnet' | 'futurenet';

export interface WalletAccount {
  publicKey: string;
  network: StellarNetwork;
}

export interface ServerPermissions {
  canSign: boolean;
  accountPublicKey: string;
  network: StellarNetwork;
  confirmedAt: number;
}

export interface WalletHealthSnapshot {
  account: WalletAccount | null;
  network: StellarNetwork | null;
  lastVerifiedAt: number | null;
  isStale: boolean;
  canSign: boolean;
  reason: string | null;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export function isIdentityStale(
  account: WalletAccount | null,
  permissions: ServerPermissions | null,
  now: number = Date.now(),
): boolean {
  if (!account || !permissions) {
    return true;
  }
  if (account.publicKey !== permissions.accountPublicKey) {
    return true;
  }
  if (account.network !== permissions.network) {
    return true;
  }
  return now - permissions.confirmedAt > STALE_THRESHOLD_MS;
}

export function buildWalletHealth(
  account: WalletAccount | null,
  permissions: ServerPermissions | null,
  now: number = Date.now(),
): WalletHealthSnapshot {
  const stale = isIdentityStale(account, permissions, now);
  const canSign = !stale && !!permissions && permissions.canSign;

  let reason: string | null = null;
  if (!account) {
    reason = 'No wallet connected';
  } else if (!permissions) {
    reason = 'Awaiting server confirmation';
  } else if (stale) {
    reason = 'Wallet identity is stale — reconnect to continue';
  } else if (!permissions.canSign) {
    reason = 'Signing is not permitted for this account';
  }

  return {
    account,
    network: account?.network ?? null,
    lastVerifiedAt: permissions?.confirmedAt ?? null,
    isStale: stale,
    canSign,
    reason,
  };
}

export function canSignTransaction(
  account: WalletAccount | null,
  permissions: ServerPermissions | null,
  now: number = Date.now(),
): boolean {
  return buildWalletHealth(account, permissions, now).canSign;
}

export function formatLastVerified(timestamp: number | null): string {
  if (timestamp === null) {
    return 'Never verified';
  }
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return 'Unknown';
  }
}

export function networkLabel(network: StellarNetwork | null): string {
  switch (network) {
    case 'public':
      return 'Stellar Public Network';
    case 'testnet':
      return 'Stellar Testnet';
    case 'futurenet':
      return 'Stellar Futurenet';
    default:
      return 'No network selected';
  }
}

export function accessibilityLabelForHealth(snapshot: WalletHealthSnapshot): string {
  const accountPart = snapshot.account
    ? `Connected account ${snapshot.account.publicKey.slice(0, 6)}…${snapshot.account.publicKey.slice(-4)}`
    : 'No wallet connected';
  const networkPart = networkLabel(snapshot.network);
  const verifiedPart = `Last verified ${formatLastVerified(snapshot.lastVerifiedAt)}`;
  const statusPart = snapshot.canSign ? 'Signing enabled' : snapshot.reason ?? 'Signing blocked';
  return [accountPart, networkPart, verifiedPart, statusPart].join('. ');
}

export const walletHealthPlatform = Platform.OS;
