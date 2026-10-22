import * as StellarSdk from '@stellar/stellar-sdk';
import * as SecureStore from 'expo-secure-store';

import config from '../config';
import logger from './loggerService';

const SECRET_STORE_KEY = 'stellar.secret';

// In-memory guard to prevent duplicate friendbot requests
const pendingFriendbot = new Set<string>();

function horizonUrl(): string {
  return config.env === 'production'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';
}

function getServer() {
  return new StellarSdk.Horizon.Server(horizonUrl());
}

export async function storeSecret(secret: string): Promise<void> {
  // Never log or return secret
  await SecureStore.setItemAsync(SECRET_STORE_KEY, secret);
}

export async function clearSecret(): Promise<void> {
  await SecureStore.deleteItemAsync(SECRET_STORE_KEY);
}

async function getSecret(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECRET_STORE_KEY);
  } catch (err) {
    logger.warn('secure_store_read_failed', { error: (err as Error).message });
    return null;
  }
}

export async function getStoredSecret(): Promise<string | null> {
  return getSecret();
}

export async function getPublicKeyFromStoredSecret(): Promise<string | null> {
  const secret = await getSecret();
  if (!secret) return null;
  try {
    const kp = StellarSdk.Keypair.fromSecret(secret);
    return kp.publicKey();
  } catch (err) {
    logger.warn('invalid_stellar_secret', { error: (err as Error).message });
    return null;
  }
}

export async function getBalance(publicKey: string): Promise<{ balance: string } | null> {
  try {
    const server = getServer();
    const acct = await server.accounts().accountId(publicKey).call();
    const native = acct.balances.find((b: any) => b.asset_type === 'native');
    return { balance: native ? String(native.balance) : '0' };
  } catch (err) {
    logger.error('stellar_balance_failed', { publicKey }, err as Error);
    return null;
  }
}

export interface TxRow {
  id: string;
  memo?: string | null;
  created_at: string;
  successful: boolean;
  source_account: string;
  operation_count?: number;
}

export async function getTransactions(
  publicKey: string,
  cursor?: string,
  limit = 20,
): Promise<{ records: TxRow[]; next?: string } | null> {
  try {
    const server = getServer();
    const res = await server
      .transactions()
      .forAccount(publicKey)
      .limit(limit)
      .order('desc')
      .cursor(cursor ?? 'now')
      .call();
    const rows: TxRow[] = res.records.map((r: any) => ({
      id: r.id,
      memo: r.memo ?? null,
      created_at: r.created_at,
      successful: r.successful,
      source_account: r.source_account,
      operation_count: r.operation_count,
    }));
    // Horizon provides a next link containing a cursor; return the paging token of the last record
    const next =
      res.records.length > 0 ? res.records[res.records.length - 1].paging_token : undefined;
    return { records: rows, next };
  } catch (err) {
    logger.error('stellar_tx_history_failed', { publicKey }, err as Error);
    return null;
  }
}

export async function fundTestnet(
  publicKey: string,
): Promise<{ success: boolean; message?: string }> {
  if (config.env === 'production') {
    return { success: false, message: 'Friendbot is disabled in production' };
  }

  if (pendingFriendbot.has(publicKey)) {
    return { success: false, message: 'Funding already in progress' };
  }

  pendingFriendbot.add(publicKey);
  try {
    const url = `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      logger.warn('friendbot_failed', { status: res.status, body: text });
      return { success: false, message: `Friendbot failed: ${res.status}` };
    }
    await getBalance(publicKey); // refresh cache if caller expects
    return { success: true };
  } catch (err) {
    logger.error('friendbot_error', { publicKey }, err as Error);
    return { success: false, message: (err as Error).message };
  } finally {
    pendingFriendbot.delete(publicKey);
  }
}

export default {
  storeSecret,
  clearSecret,
  getPublicKeyFromStoredSecret,
  getBalance,
  getTransactions,
  fundTestnet,
};
