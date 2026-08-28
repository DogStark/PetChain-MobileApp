/**
 * Decode and review a Stellar transaction before it is signed (issue #945).
 *
 * ## Why decode rather than display the quote
 *
 * The confirm screen used to render fields from the server-supplied
 * `PathPaymentQuote` and then sign `preparedPayment.transactionXdr`. Those are
 * two different objects. Nothing checked that the envelope actually being
 * signed matched the numbers the user was shown, so a wrong — or tampered —
 * `transactionXdr` would be approved against a reassuring summary.
 *
 * Signing is irreversible, so the review must describe **the bytes being
 * signed**. This module decodes the envelope and reports what it really does,
 * and `compareQuoteToSimulation` flags any field where the quote and the
 * envelope disagree.
 *
 * Everything here is pure: XDR in, plain data out. No network, no clock, no
 * device APIs.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

import type { PathPaymentQuote } from './stellarPathPaymentService';

/** Stroops per XLM. */
const STROOPS_PER_XLM = 10_000_000;

export interface SimulatedOperation {
  index: number;
  /** SDK operation type, e.g. 'payment', 'pathPaymentStrictReceive'. */
  type: string;
  /** Recipient, when the operation has one. */
  destination?: string;
  /** Asset leaving the account, as 'XLM' or 'CODE:ISSUER'. */
  sendAsset?: string;
  /** Maximum that may leave the account. */
  sendMax?: string;
  /** Asset arriving at the destination. */
  destinationAsset?: string;
  /** Exact amount arriving at the destination. */
  destinationAmount?: string;
}

export interface TransactionSimulation {
  sourceAccount: string;
  /** Total fee in stroops, as declared by the envelope. */
  feeStroops: string;
  /** The same fee in XLM, for display. */
  feeXlm: string;
  memo: { type: string; value: string | null };
  sequence: string;
  networkPassphrase: string;
  /** Resolved network name, or 'UNKNOWN' for an unrecognised passphrase. */
  network: 'PUBLIC' | 'TESTNET' | 'UNKNOWN';
  operationCount: number;
  operations: SimulatedOperation[];
  /** Number of signatures already attached. */
  signatureCount: number;
}

export class TransactionSimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionSimulationError';
  }
}

function stroopsToXlm(stroops: string | number): string {
  const value = typeof stroops === 'number' ? stroops : Number(stroops);
  if (!Number.isFinite(value)) return '0';
  return (value / STROOPS_PER_XLM).toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
}

/** Render an asset as 'XLM' or 'CODE:ISSUER'. */
export function formatAsset(asset: unknown): string | undefined {
  if (!asset || typeof asset !== 'object') return undefined;
  const typed = asset as {
    isNative?: () => boolean;
    getCode?: () => string;
    getIssuer?: () => string;
    code?: string;
    issuer?: string;
  };
  try {
    if (typeof typed.isNative === 'function' && typed.isNative()) return 'XLM';
    const code = typeof typed.getCode === 'function' ? typed.getCode() : typed.code;
    const issuer = typeof typed.getIssuer === 'function' ? typed.getIssuer() : typed.issuer;
    if (!code) return undefined;
    return issuer ? `${code}:${issuer}` : code;
  } catch {
    return undefined;
  }
}

function resolveNetwork(passphrase: string): TransactionSimulation['network'] {
  if (passphrase === StellarSdk.Networks.PUBLIC) return 'PUBLIC';
  if (passphrase === StellarSdk.Networks.TESTNET) return 'TESTNET';
  return 'UNKNOWN';
}

function describeMemo(memo: unknown): TransactionSimulation['memo'] {
  const typed = memo as { type?: string; value?: unknown } | null | undefined;
  if (!typed || !typed.type || typed.type === 'none') {
    return { type: 'none', value: null };
  }
  const raw = typed.value;
  if (raw === null || raw === undefined) return { type: typed.type, value: null };
  if (typeof raw === 'string') return { type: typed.type, value: raw };

  if (Buffer.isBuffer(raw)) {
    // The SDK hands back a Buffer for every memo type. A *text* memo must be
    // rendered as the text the sender wrote — showing a reviewer
    // "706574636861696e" instead of "petchain" defeats the point of the review.
    // Hash and return memos are genuinely binary, so those stay hex.
    return {
      type: typed.type,
      value: typed.type === 'text' ? raw.toString('utf8') : raw.toString('hex'),
    };
  }

  return { type: typed.type, value: String(raw) };
}

/**
 * Decode a transaction envelope into a reviewable summary.
 *
 * @param xdr Base64 transaction envelope.
 * @param networkPassphrase Passphrase of the network it is intended for.
 * @throws {TransactionSimulationError} when the XDR cannot be decoded.
 */
export function simulateTransactionXdr(
  xdr: string,
  networkPassphrase: string,
): TransactionSimulation {
  let tx: StellarSdk.Transaction;
  try {
    tx = new StellarSdk.Transaction(xdr, networkPassphrase);
  } catch (error) {
    throw new TransactionSimulationError(
      `Unable to decode the transaction for review: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const operations: SimulatedOperation[] = tx.operations.map((op, index) => {
    const anyOp = op as unknown as Record<string, unknown>;
    return {
      index,
      type: String(anyOp.type ?? 'unknown'),
      destination: typeof anyOp.destination === 'string' ? anyOp.destination : undefined,
      sendAsset: formatAsset(anyOp.sendAsset ?? anyOp.asset),
      sendMax:
        typeof anyOp.sendMax === 'string'
          ? anyOp.sendMax
          : typeof anyOp.amount === 'string' && anyOp.sendAsset === undefined
            ? anyOp.amount
            : undefined,
      destinationAsset: formatAsset(anyOp.destAsset),
      destinationAmount:
        typeof anyOp.destAmount === 'string'
          ? anyOp.destAmount
          : typeof anyOp.amount === 'string'
            ? anyOp.amount
            : undefined,
    };
  });

  return {
    sourceAccount: tx.source,
    feeStroops: String(tx.fee),
    feeXlm: stroopsToXlm(tx.fee),
    memo: describeMemo(tx.memo),
    sequence: String(tx.sequence),
    networkPassphrase,
    network: resolveNetwork(networkPassphrase),
    operationCount: tx.operations.length,
    operations,
    signatureCount: tx.signatures?.length ?? 0,
  };
}

// ── Quote / envelope agreement ─────────────────────────────────────────────

export type DiscrepancySeverity = 'blocking' | 'warning';

export interface Discrepancy {
  field: string;
  expected: string;
  actual: string;
  severity: DiscrepancySeverity;
  message: string;
}

/**
 * Compare what the user was shown against what they are about to sign.
 *
 * `blocking` discrepancies mean value could move differently than displayed and
 * must prevent signing. `warning` covers presentational drift.
 */
export function compareQuoteToSimulation(
  quote: PathPaymentQuote,
  simulation: TransactionSimulation,
  expectedNetwork?: TransactionSimulation['network'],
): Discrepancy[] {
  const problems: Discrepancy[] = [];

  if (expectedNetwork && simulation.network !== expectedNetwork) {
    problems.push({
      field: 'network',
      expected: expectedNetwork,
      actual: simulation.network,
      severity: 'blocking',
      message: `This transaction is built for ${simulation.network}, but the app is configured for ${expectedNetwork}.`,
    });
  }

  if (simulation.operationCount === 0) {
    problems.push({
      field: 'operations',
      expected: '1',
      actual: '0',
      severity: 'blocking',
      message: 'The transaction contains no operations.',
    });
  }

  const paymentOp = simulation.operations.find(
    (op) => op.destinationAmount !== undefined || op.sendMax !== undefined,
  );

  if (paymentOp) {
    if (
      paymentOp.destinationAmount !== undefined &&
      Number(paymentOp.destinationAmount) !== Number(quote.destinationAmount)
    ) {
      problems.push({
        field: 'destinationAmount',
        expected: quote.destinationAmount,
        actual: paymentOp.destinationAmount,
        severity: 'blocking',
        message: `The quote shows ${quote.destinationAmount} XLM arriving, but the transaction sends ${paymentOp.destinationAmount}.`,
      });
    }

    if (
      paymentOp.sendMax !== undefined &&
      Number(paymentOp.sendMax) !== Number(quote.sourceAmount)
    ) {
      problems.push({
        field: 'sourceAmount',
        expected: quote.sourceAmount,
        actual: paymentOp.sendMax,
        severity: 'blocking',
        message: `The quote spends at most ${quote.sourceAmount} ${quote.sourceAsset.code}, but the transaction allows ${paymentOp.sendMax}.`,
      });
    }
  }

  return problems;
}

// ── Quote freshness ────────────────────────────────────────────────────────

export interface QuoteFreshness {
  expiresAtMs: number;
  msRemaining: number;
  secondsRemaining: number;
  isExpired: boolean;
  /** True within the final stretch, so the UI can warn before it lapses. */
  isExpiringSoon: boolean;
}

/** A quote inside this window is shown as about to lapse. */
export const QUOTE_EXPIRY_WARNING_MS = 30_000;

/**
 * Evaluate a quote's expiry (issue #945: "stale-simulation expiry").
 *
 * `PathPaymentQuote.expiresAt` already existed and was never read, so a user
 * could leave the confirm screen open and sign at a rate that had long since
 * moved. An unparseable or absent expiry is treated as **expired**: refusing to
 * sign is the safe direction.
 */
export function evaluateQuoteFreshness(
  quote: Pick<PathPaymentQuote, 'expiresAt'>,
  nowMs: number = Date.now(),
): QuoteFreshness {
  const expiresAtMs = Date.parse(quote.expiresAt ?? '');

  if (!Number.isFinite(expiresAtMs)) {
    return {
      expiresAtMs: 0,
      msRemaining: 0,
      secondsRemaining: 0,
      isExpired: true,
      isExpiringSoon: true,
    };
  }

  const msRemaining = Math.max(0, expiresAtMs - nowMs);
  return {
    expiresAtMs,
    msRemaining,
    secondsRemaining: Math.ceil(msRemaining / 1000),
    isExpired: msRemaining <= 0,
    isExpiringSoon: msRemaining > 0 && msRemaining <= QUOTE_EXPIRY_WARNING_MS,
  };
}

/** Whether signing may proceed, and why not when it may not. */
export function canSignQuote(
  freshness: QuoteFreshness,
  discrepancies: Discrepancy[],
): { allowed: boolean; reason?: string } {
  if (freshness.isExpired) {
    return { allowed: false, reason: 'This quote has expired. Refresh it to get a current rate.' };
  }
  const blocking = discrepancies.find((d) => d.severity === 'blocking');
  if (blocking) {
    return { allowed: false, reason: blocking.message };
  }
  return { allowed: true };
}
