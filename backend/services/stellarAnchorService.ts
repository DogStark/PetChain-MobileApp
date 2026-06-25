/**
 * Stellar SEP-24 Interactive Deposit (Fiat On-Ramp)
 *
 * Flow:
 *  1. Client calls initiateDeposit → backend fetches SEP-24 interactive URL from anchor
 *  2. Client opens the URL in a WebView; user completes KYC / bank transfer
 *  3. Client polls getDepositStatus until status is 'completed' or 'error'
 *
 * Supported anchors (configured via env):
 *   ANCHOR_HOME_DOMAIN  – e.g. "testanchor.stellar.org"
 *   ANCHOR_ASSET_CODE   – e.g. "USDC"
 *   ANCHOR_ASSET_ISSUER – Stellar public key of the asset issuer
 *
 * References:
 *   https://stellar.org/protocol/sep-24
 *   https://stellar.org/protocol/sep-10  (auth)
 */

import { EventEmitter } from 'events';

import * as StellarSdk from '@stellar/stellar-sdk';

const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === 'mainnet'
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

const ANCHOR_HOME_DOMAIN = process.env.ANCHOR_HOME_DOMAIN ?? 'testanchor.stellar.org';
const ANCHOR_ASSET_CODE = process.env.ANCHOR_ASSET_CODE ?? 'SRT';
const ANCHOR_ASSET_ISSUER =
  process.env.ANCHOR_ASSET_ISSUER ?? 'GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6';

export type DepositStatus =
  | 'pending_user_transfer_start'
  | 'pending_external'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'completed'
  | 'error'
  | 'refunded';

export type AnchorFlowKind = 'deposit' | 'withdrawal';

export interface DepositRecord {
  id: string;
  userId: string;
  walletAddress: string;
  assetCode: string;
  currency: string;
  flowKind?: AnchorFlowKind;
  amount?: string;
  amountIn?: string;
  amountOut?: string;
  interactiveUrl: string;
  status: DepositStatus;
  message?: string;
  reason?: string;
  stellarTxId?: string;
  anchorTransactionId?: string;
  webAuthEndpoint?: string;
  authKeypair?: StellarSdk.Keypair;
  createdAt: Date;
  updatedAt: Date;
}

export interface InitiateDepositResult {
  depositId: string;
  interactiveUrl: string;
  assetCode: string;
  currency: string;
}

// ─── SEP-1 / TOML helpers ────────────────────────────────────────────────────

interface StellarToml {
  TRANSFER_SERVER_SEP0024?: string;
  WEB_AUTH_ENDPOINT?: string;
}

interface Sep10AuthContext {
  webAuthEndpoint: string;
  accountId: string;
}

interface TransactionPayload {
  status: DepositStatus;
  amount_in?: string;
  amount_out?: string;
  message?: string;
  reason?: string;
  stellar_transaction_id?: string;
}

const PENDING_EXTERNAL_TIMEOUT_MS = 10 * 60 * 1000;

async function fetchStellarToml(homeDomain: string): Promise<StellarToml> {
  const url = `https://${homeDomain}/.well-known/stellar.toml`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch stellar.toml from ${homeDomain}`);
  const text = await res.text();
  return parseStellarToml(text);
}

function parseStellarToml(toml: string): StellarToml {
  const result: Record<string, string> = {};
  for (const line of toml.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*"([^"]+)"/);
    if (match) result[match[1]] = match[2];
  }
  return result as StellarToml;
}

// ─── SEP-10 Web Auth ─────────────────────────────────────────────────────────

async function getSep10Token(webAuthEndpoint: string, accountId: string): Promise<string> {
  // Step 1: GET challenge
  const challengeRes = await fetch(`${webAuthEndpoint}?account=${accountId}`);
  if (!challengeRes.ok) throw new Error('SEP-10 challenge request failed');
  const { transaction: challengeXdr } = (await challengeRes.json()) as {
    transaction: string;
  };

  // Step 2: Exchange the challenge for a token
  const tokenRes = await fetch(webAuthEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: challengeXdr }),
  });
  if (!tokenRes.ok) throw new Error('SEP-10 token request failed');
  const { token } = (await tokenRes.json()) as { token: string };
  return token;
}

// ─── In-memory deposit store (replace with DB in production) ─────────────────

const transactions = new Map<string, DepositRecord>();
const deposits = transactions;

function generateId(): string {
  return `dep_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function isTerminalStatus(status: DepositStatus): boolean {
  return status === 'completed' || status === 'error' || status === 'refunded';
}

// ─── Public API ──────────────────────────────────────────────────────────────

export class StellarAnchorService extends EventEmitter {
  private readonly homeDomain: string;
  private readonly assetCode: string;
  private readonly assetIssuer: string;

  constructor(
    homeDomain = ANCHOR_HOME_DOMAIN,
    assetCode = ANCHOR_ASSET_CODE,
    assetIssuer = ANCHOR_ASSET_ISSUER,
  ) {
    super();
    this.homeDomain = homeDomain;
    this.assetCode = assetCode;
    this.assetIssuer = assetIssuer;
  }

  /**
   * Initiate a SEP-24 interactive deposit.
   *
   * @param userId       Internal user ID (for record-keeping)
   * @param walletAddress  User's Stellar public key
   * @param currency     Fiat currency code, e.g. "USD" or "EUR"
   * @param userSecret   Optional: user's Stellar secret for SEP-10 auth.
   *                     If omitted, a temporary keypair is used (anchor may
   *                     still require the user to authenticate in the WebView).
   */
  async initiateDeposit(
    userId: string,
    walletAddress: string,
    currency: string,
    userSecret?: string,
  ): Promise<InitiateDepositResult> {
    const record = await this.initiateInteractiveTransaction({
      flowKind: 'deposit',
      userId,
      walletAddress,
      currency,
      userSecret,
      amount: undefined,
    });

    return {
      depositId: record.id,
      interactiveUrl: record.interactiveUrl,
      assetCode: this.assetCode,
      currency,
    };
  }

  /**
   * Initiate a SEP-24 interactive withdrawal.
   */
  async initiateWithdrawal(
    userId: string,
    walletAddress: string,
    currency: string,
    amount: string,
    userSecret?: string,
  ): Promise<InitiateDepositResult> {
    const record = await this.initiateInteractiveTransaction({
      flowKind: 'withdrawal',
      userId,
      walletAddress,
      currency,
      amount,
      userSecret,
    });

    return {
      depositId: record.id,
      interactiveUrl: record.interactiveUrl,
      assetCode: this.assetCode,
      currency,
    };
  }

  /**
   * Poll the anchor for the current transaction status.
   * The anchor transaction ID is stored in record.message.
   */
  async getDepositStatus(depositId: string): Promise<DepositRecord> {
    return this.pollTransactionStatus(depositId);
  }

  async pollTransactionStatus(transactionId: string): Promise<DepositRecord> {
    const record = transactions.get(transactionId);
    if (!record) throw new Error(`Deposit ${transactionId} not found`);

    // If already terminal, return cached state
    if (isTerminalStatus(record.status)) {
      return record;
    }

    const anchorTxId = record.anchorTransactionId ?? record.message;
    if (!anchorTxId) return record;

    const ageBeforePollMs = Date.now() - record.updatedAt.getTime();

    try {
      const toml = await fetchStellarToml(this.homeDomain);
      const transferServer = toml.TRANSFER_SERVER_SEP0024;
      if (!transferServer) return record;

      const transaction = await this.fetchAnchorTransaction(
        transferServer,
        anchorTxId,
        record.webAuthEndpoint
          ? { webAuthEndpoint: record.webAuthEndpoint, accountId: record.walletAddress }
          : undefined,
      );
      if (!transaction) return record;

      record.status = transaction.status;
      record.amountIn = transaction.amount_in;
      record.amountOut = transaction.amount_out;
      record.reason = transaction.reason ?? transaction.message ?? record.reason;
      record.stellarTxId = transaction.stellar_transaction_id;
      if (transaction.message) record.message = transaction.message;
      record.updatedAt = new Date();
      transactions.set(transactionId, record);

      if (record.status === 'completed') {
        this.emit('balance:refresh', {
          transactionId,
          flowKind: record.flowKind ?? 'deposit',
          walletAddress: record.walletAddress,
          currency: record.currency,
        });
      }

      if (record.status === 'pending_external' && ageBeforePollMs >= PENDING_EXTERNAL_TIMEOUT_MS) {
        record.status = 'error';
        record.reason = record.reason ?? 'pending_external timeout';
        record.updatedAt = new Date();
        transactions.set(transactionId, record);
        this.emit('anchor:timeout', {
          transactionId,
          flowKind: record.flowKind ?? 'deposit',
          walletAddress: record.walletAddress,
          currency: record.currency,
        });
      }
    } catch {
      // Network error — return last known state
    }

    return record;
  }

  /** List all deposits for a user. */
  getDepositsForUser(userId: string): DepositRecord[] {
    return Array.from(transactions.values()).filter((d) => d.userId === userId);
  }

  getTransactionsForUser(userId: string): DepositRecord[] {
    return this.getDepositsForUser(userId);
  }

  private async initiateInteractiveTransaction(input: {
    flowKind: AnchorFlowKind;
    userId: string;
    walletAddress: string;
    currency: string;
    amount?: string;
    userSecret?: string;
  }): Promise<DepositRecord> {
    const toml = await fetchStellarToml(this.homeDomain);

    const transferServer = toml.TRANSFER_SERVER_SEP0024;
    if (!transferServer) {
      throw new Error(`Anchor ${this.homeDomain} does not support SEP-24`);
    }

    const keypair = input.userSecret
      ? StellarSdk.Keypair.fromSecret(input.userSecret)
      : StellarSdk.Keypair.random();

    let jwtToken: string | undefined;
    if (toml.WEB_AUTH_ENDPOINT) {
      jwtToken = await getSep10Token(toml.WEB_AUTH_ENDPOINT, input.walletAddress);
    }

    const endpoint =
      input.flowKind === 'withdrawal'
        ? `${transferServer}/transactions/withdraw/interactive`
        : `${transferServer}/transactions/deposit/interactive`;

    const body = new URLSearchParams({
      asset_code: this.assetCode,
      asset_issuer: this.assetIssuer,
      account: input.walletAddress,
      lang: 'en',
    });

    if (input.amount) {
      body.set('amount', input.amount);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;

    const anchorRes = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!anchorRes.ok) {
      const err = await anchorRes.text();
      throw new Error(`SEP-24 ${input.flowKind} initiation failed: ${err}`);
    }

    const { id: anchorId, url: interactiveUrl } = (await anchorRes.json()) as {
      id: string;
      url: string;
      type: string;
    };

    const transactionId = generateId();
    const record: DepositRecord = {
      id: transactionId,
      userId: input.userId,
      walletAddress: input.walletAddress,
      assetCode: this.assetCode,
      currency: input.currency,
      amount: input.amount,
      interactiveUrl,
      status: input.flowKind === 'withdrawal' ? 'pending_anchor' : 'pending_user_transfer_start',
      flowKind: input.flowKind,
      anchorTransactionId: anchorId,
      webAuthEndpoint: toml.WEB_AUTH_ENDPOINT,
      authKeypair: keypair,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    record.message = anchorId;
    transactions.set(transactionId, record);

    return record;
  }

  private async fetchAnchorTransaction(
    transferServer: string,
    anchorTxId: string,
    authContext?: Sep10AuthContext,
  ): Promise<TransactionPayload | null> {
    const url = `${transferServer}/transaction?id=${anchorTxId}`;
    const res = await fetch(url);

    if (res.ok) {
      const { transaction } = (await res.json()) as { transaction: TransactionPayload };
      return transaction;
    }

    if (authContext && res.status === 401) {
      this.emit('anchor:reauthenticate', {
        anchorTxId,
        webAuthEndpoint: authContext.webAuthEndpoint,
      });

      const jwtToken = await getSep10Token(authContext.webAuthEndpoint, authContext.accountId);
      const retryRes = await fetch(url, {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
        },
      });

      if (!retryRes.ok) return null;

      const { transaction } = (await retryRes.json()) as { transaction: TransactionPayload };
      return transaction;
    }

    return null;
  }
}

export const stellarAnchorService = new StellarAnchorService();
export default stellarAnchorService;
