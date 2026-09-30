/**
 * Trustline Service
 * Issue #101 — Stellar Trustline Management UI
 *
 * Uses @stellar/stellar-sdk directly on the client for trustline operations
 * on Stellar testnet. Secret key is never sent to the backend.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

import type {
  TrustlineAsset,
  TrustlineState,
  TrustlineTransaction,
  AddTrustlineParams,
  RemoveTrustlineParams,
  PetChainAssetDefinition,
} from '../models/Trustline';

// ─── Network config ───────────────────────────────────────────────────────────

const STELLAR_NETWORK = (process.env.STELLAR_NETWORK ?? 'TESTNET') as 'TESTNET' | 'PUBLIC';
const HORIZON_URL =
  STELLAR_NETWORK === 'PUBLIC'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  STELLAR_NETWORK === 'PUBLIC' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;

/** XLM reserve locked per trustline on Stellar */
export const XLM_RESERVE_PER_TRUSTLINE = 0.5;

/** Base account reserve (2 XLM) */
const BASE_RESERVE_XLM = 2;

// ─── PetChain asset registry ──────────────────────────────────────────────────

export const PETCHAIN_ASSETS: PetChainAssetDefinition[] = [
  {
    assetCode: 'PETC',
    issuerPublicKey:
      process.env.PETCHAIN_ISSUER_PUBLIC_KEY ??
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    name: 'PetChain Token',
    description: 'Core utility token for the PetChain ecosystem',
    iconEmoji: '🐾',
  },
  {
    assetCode: 'VETH',
    issuerPublicKey:
      process.env.PETCHAIN_ISSUER_PUBLIC_KEY ??
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    name: 'Vet Health Credit',
    description: 'Redeemable credits for veterinary services',
    iconEmoji: '🏥',
  },
  {
    assetCode: 'PAWP',
    issuerPublicKey:
      process.env.PETCHAIN_ISSUER_PUBLIC_KEY ??
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    name: 'PawPoints',
    description: 'Loyalty reward points earned through PetChain activity',
    iconEmoji: '⭐',
  },
];

const PETCHAIN_ASSET_CODES = new Set(PETCHAIN_ASSETS.map((a) => a.assetCode));

// ─── Error class ──────────────────────────────────────────────────────────────

export class TrustlineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'TrustlineError';
  }
}

// ─── Reserve & liability checks (Issue #950) ─────────────────────────────────

export interface ReserveImpact {
  action: 'add' | 'remove';
  /** +0.5 when adding a trustline, -0.5 when removing one */
  reserveDeltaXlm: number;
  /** Total XLM that would be locked in reserves after the action */
  projectedReservedXlm: number;
  /** XLM that would remain spendable after the action (never negative) */
  projectedAvailableXlm: string;
  /** For `add`: whether the account can cover the extra reserve */
  sufficient: boolean;
  /** Human-readable explanation suitable for a confirmation dialog */
  summary: string;
}

/**
 * Explain how adding or removing a single trustline changes the account's
 * locked XLM reserve, and whether the account can afford an addition.
 */
export function describeReserveImpact(
  state: TrustlineState,
  action: 'add' | 'remove',
): ReserveImpact {
  const reserveDeltaXlm =
    action === 'add' ? XLM_RESERVE_PER_TRUSTLINE : -XLM_RESERVE_PER_TRUSTLINE;
  const projectedReservedXlm = Math.max(0, state.totalReservedXlm + reserveDeltaXlm);
  const rawAvailable = parseFloat(state.xlmBalance) - projectedReservedXlm;
  const sufficient = action === 'remove' || rawAvailable >= 0;

  const summary =
    action === 'add'
      ? `Adding this trustline locks an extra ${XLM_RESERVE_PER_TRUSTLINE} XLM ` +
        `(reserve ${state.totalReservedXlm} → ${projectedReservedXlm} XLM). ` +
        (sufficient
          ? `You would have ${Math.max(0, rawAvailable).toFixed(7)} XLM available.`
          : `You are short ${Math.abs(rawAvailable).toFixed(7)} XLM — fund the account first.`)
      : `Removing this trustline frees ${XLM_RESERVE_PER_TRUSTLINE} XLM ` +
        `(reserve ${state.totalReservedXlm} → ${projectedReservedXlm} XLM).`;

  return {
    action,
    reserveDeltaXlm,
    projectedReservedXlm,
    projectedAvailableXlm: Math.max(0, rawAvailable).toFixed(7),
    sufficient,
    summary,
  };
}

/** True when the account can cover the +0.5 XLM reserve for one more trustline. */
export function canAffordNewTrustline(state: TrustlineState): boolean {
  return describeReserveImpact(state, 'add').sufficient;
}

/**
 * Guard trustline removal. Removal is only safe when the line holds no balance
 * and has no buying/selling liabilities — open offers referencing the asset
 * would otherwise be stranded and the `change_trust` op would fail with
 * `CHANGE_TRUST_INVALID_LIMIT`.
 */
export function assertTrustlineRemovable(line: {
  assetCode: string;
  balance: string;
  selling_liabilities?: string;
  buying_liabilities?: string;
  sellingLiabilities?: string;
  buyingLiabilities?: string;
}): void {
  if (parseFloat(line.balance || '0') > 0) {
    throw new TrustlineError(
      `Cannot remove trustline: balance is ${line.balance} ${line.assetCode}. ` +
        `Transfer or burn the balance first.`,
      'NON_ZERO_BALANCE',
    );
  }

  const selling = parseFloat(line.selling_liabilities ?? line.sellingLiabilities ?? '0');
  const buying = parseFloat(line.buying_liabilities ?? line.buyingLiabilities ?? '0');
  if (selling > 0 || buying > 0) {
    throw new TrustlineError(
      `Cannot remove trustline for ${line.assetCode}: open offers hold ` +
        `${selling > 0 ? `${selling} (selling)` : `${buying} (buying)`} in liabilities. ` +
        `Cancel those offers first.`,
      'HAS_LIABILITIES',
    );
  }
}

// ─── Horizon server (lazy singleton) ─────────────────────────────────────────

let _server: StellarSdk.Horizon.Server | null = null;
function getServer(): StellarSdk.Horizon.Server {
  if (!_server) _server = new StellarSdk.Horizon.Server(HORIZON_URL);
  return _server;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBalance(balances: StellarSdk.Horizon.HorizonApi.BalanceLine[]): {
  xlm: string;
  trustlines: TrustlineAsset[];
} {
  let xlm = '0';
  const trustlines: TrustlineAsset[] = [];

  for (const b of balances) {
    if (b.asset_type === 'native') {
      xlm = b.balance;
    } else if (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') {
      const code = b.asset_code;
      const issuer = b.asset_issuer;
      const line = b as { selling_liabilities?: string; buying_liabilities?: string };
      trustlines.push({
        assetCode: code,
        issuerPublicKey: issuer,
        issuerLabel: PETCHAIN_ASSETS.find((a) => a.assetCode === code)?.name,
        balance: b.balance,
        limit: b.limit,
        sellingLiabilities: line.selling_liabilities ?? '0',
        buyingLiabilities: line.buying_liabilities ?? '0',
        isPetChainAsset: PETCHAIN_ASSET_CODES.has(code),
      });
    }
  }

  return { xlm, trustlines };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Load full trustline state for an account */
export async function loadTrustlineState(publicKey: string): Promise<TrustlineState> {
  try {
    const account = await getServer().loadAccount(publicKey);
    const { xlm, trustlines } = parseBalance(
      account.balances as StellarSdk.Horizon.HorizonApi.BalanceLine[],
    );

    const totalReservedXlm = BASE_RESERVE_XLM + trustlines.length * XLM_RESERVE_PER_TRUSTLINE;
    const available = Math.max(0, parseFloat(xlm) - totalReservedXlm).toFixed(7);

    return {
      accountPublicKey: publicKey,
      xlmBalance: xlm,
      xlmReservePerTrustline: XLM_RESERVE_PER_TRUSTLINE,
      trustlines,
      totalReservedXlm,
      availableXlm: available,
    };
  } catch (err) {
    if (err instanceof StellarSdk.NotFoundError) {
      throw new TrustlineError('Account not found on Stellar network', 'ACCOUNT_NOT_FOUND');
    }
    throw new TrustlineError(
      err instanceof Error ? err.message : 'Failed to load account',
      'LOAD_FAILED',
    );
  }
}

/** Add a trustline for an asset */
export async function addTrustline(params: AddTrustlineParams): Promise<string> {
  const { accountSecretKey, assetCode, issuerPublicKey, limit } = params;

  try {
    const keypair = StellarSdk.Keypair.fromSecret(accountSecretKey);
    const server = getServer();
    const account = await server.loadAccount(keypair.publicKey());

    const asset = new StellarSdk.Asset(assetCode, issuerPublicKey);
    const op = StellarSdk.Operation.changeTrust({
      asset,
      ...(limit ? { limit } : {}),
    });

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: String(await server.fetchBaseFee()),
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    tx.sign(keypair);
    const result = await server.submitTransaction(tx);
    return result.hash;
  } catch (err) {
    if (err instanceof TrustlineError) throw err;
    const msg = extractStellarError(err) ?? (err instanceof Error ? err.message : 'Unknown error');
    throw new TrustlineError(`Failed to add trustline: ${msg}`, 'ADD_FAILED');
  }
}

/** Remove a trustline (only allowed when balance is zero) */
export async function removeTrustline(params: RemoveTrustlineParams): Promise<string> {
  const { accountSecretKey, assetCode, issuerPublicKey } = params;

  try {
    const keypair = StellarSdk.Keypair.fromSecret(accountSecretKey);
    const server = getServer();
    const account = await server.loadAccount(keypair.publicKey());

    // Verify balance is zero before attempting removal
    const balances = account.balances as StellarSdk.Horizon.HorizonApi.BalanceLine[];
    const existing = balances.find(
      (b) =>
        (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
        b.asset_code === assetCode &&
        b.asset_issuer === issuerPublicKey,
    );

    if (!existing) {
      throw new TrustlineError('Trustline does not exist', 'NOT_FOUND');
    }
    // Block removal on non-zero balance OR outstanding buying/selling liabilities.
    assertTrustlineRemovable({
      assetCode,
      balance: existing.balance,
      selling_liabilities: (existing as { selling_liabilities?: string }).selling_liabilities,
      buying_liabilities: (existing as { buying_liabilities?: string }).buying_liabilities,
    });

    const asset = new StellarSdk.Asset(assetCode, issuerPublicKey);
    // Setting limit to '0' removes the trustline
    const op = StellarSdk.Operation.changeTrust({ asset, limit: '0' });

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: String(await server.fetchBaseFee()),
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    tx.sign(keypair);
    const result = await server.submitTransaction(tx);
    return result.hash;
  } catch (err) {
    if (err instanceof TrustlineError) throw err;
    const msg = extractStellarError(err) ?? (err instanceof Error ? err.message : 'Unknown error');
    throw new TrustlineError(`Failed to remove trustline: ${msg}`, 'REMOVE_FAILED');
  }
}

/** Fetch trustline-related transaction history for an account */
export async function loadTrustlineHistory(
  publicKey: string,
  limit = 20,
): Promise<TrustlineTransaction[]> {
  try {
    const server = getServer();
    const ops = await server.operations().forAccount(publicKey).limit(limit).order('desc').call();

    const results: TrustlineTransaction[] = [];

    for (const op of ops.records) {
      if (op.type === 'change_trust') {
        const ct = op as StellarSdk.Horizon.HorizonApi.ChangeTrustOperationResponse;
        const isRemove = ct.limit === '0';
        results.push({
          id: op.id,
          type: isRemove ? 'remove_trustline' : 'add_trustline',
          assetCode: ct.asset_code ?? '',
          issuerPublicKey: ct.asset_issuer ?? '',
          txHash: ct.transaction_hash,
          createdAt: op.created_at,
          successful: op.transaction_successful ?? true,
        });
      } else if (op.type === 'payment') {
        const p = op as StellarSdk.Horizon.HorizonApi.PaymentOperationResponse;
        if (p.asset_type !== 'native') {
          results.push({
            id: op.id,
            type: 'payment',
            assetCode: p.asset_code ?? '',
            issuerPublicKey: p.asset_issuer ?? '',
            amount: p.amount,
            txHash: p.transaction_hash,
            createdAt: op.created_at,
            successful: op.transaction_successful ?? true,
          });
        }
      }
    }

    return results;
  } catch {
    throw new TrustlineError('Failed to load transaction history', 'HISTORY_FAILED');
  }
}

/** Derive public key from secret key (for display only — never store secret) */
export function publicKeyFromSecret(secretKey: string): string {
  try {
    return StellarSdk.Keypair.fromSecret(secretKey).publicKey();
  } catch {
    throw new TrustlineError('Invalid secret key', 'INVALID_SECRET');
  }
}

/** Validate a Stellar public key */
export function isValidPublicKey(key: string): boolean {
  return StellarSdk.StrKey.isValidEd25519PublicKey(key);
}

/** Validate a Stellar secret key */
export function isValidSecretKey(key: string): boolean {
  try {
    StellarSdk.Keypair.fromSecret(key);
    return true;
  } catch {
    return false;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function extractStellarError(err: unknown): string | null {
  try {
    const e = err as {
      response?: { data?: { extras?: { result_codes?: { operations?: string[] } } } };
    };
    const codes = e?.response?.data?.extras?.result_codes?.operations;
    if (codes?.length) return codes.join(', ');
  } catch {
    // ignore
  }
  return null;
}
