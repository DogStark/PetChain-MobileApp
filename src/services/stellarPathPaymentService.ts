import * as StellarSdk from '@stellar/stellar-sdk';

import config from '../config';
import apiClient from './apiClient';
import { getStoredSecret } from './stellarAccountService';
import type { Payment, Subscription, SubscriptionPlan } from '../models/Payment';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PathPaymentQuote {
  paymentId: string;
  plan: SubscriptionPlan;
  userId: string;
  sourceAsset: {
    code: string;
    issuer?: string;
    type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  };
  destinationAsset: { code: 'XLM'; type: 'native' };
  destinationAmount: string;
  sourceAmount: string;
  exchangeRate: string;
  estimatedNetworkFee: string;
  mode: 'path' | 'direct-xlm';
  path: Array<{ code: string; issuer?: string; type: string }>;
  pathCount: number;
  fallbackReason?: string;
  createdAt: string;
  expiresAt: string;
}

export interface PreparedPayment {
  payment: Payment;
  quote: PathPaymentQuote;
  transactionXdr: string;
}

export interface SubmittedPayment {
  payment: Payment;
  subscription: Subscription;
  transactionHash: string;
  quote: PathPaymentQuote;
}

export interface PathPaymentAuditEntry {
  id: string;
  paymentId: string;
  userId: string;
  plan: SubscriptionPlan;
  mode: 'quote' | 'submitted' | 'failed';
  sourceAsset: PathPaymentQuote['sourceAsset'];
  destinationAmount: string;
  sourceAmount: string;
  exchangeRate: string;
  estimatedNetworkFee: string;
  path: PathPaymentQuote['path'];
  pathCount: number;
  fallbackReason?: string;
  transactionHash?: string;
  createdAt: string;
}

export interface StellarAssetInput {
  code: string;
  issuer?: string;
  type?: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
}

function unwrap<T>(payload: ApiResponse<T> | T): T {
  if (payload && typeof payload === 'object' && 'success' in payload && payload.success) {
    return (payload as ApiResponse<T>).data;
  }
  return payload as T;
}

// ─── Slippage & expiry protection (Issue #951) ────────────────────────────────

/** Default slippage tolerance applied when a caller does not specify one: 0.50%. */
export const DEFAULT_SLIPPAGE_BPS = 50;

export class PathPaymentValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_AMOUNT'
      | 'INVALID_SLIPPAGE'
      | 'QUOTE_NO_EXPIRY'
      | 'QUOTE_EXPIRED'
      | 'ASSET_DRIFT'
      | 'PATH_DRIFT'
      | 'SLIPPAGE_EXCEEDED',
  ) {
    super(message);
    this.name = 'PathPaymentValidationError';
  }
}

/**
 * The immutable safety envelope derived from the quote the user actually
 * reviewed. Everything the transaction depends on — the floor on delivered
 * amount, the deadline, the routing path, and both assets — is bound here so a
 * later quote refresh cannot silently move any of them.
 */
export interface QuoteBinding {
  minDestinationAmount: string;
  deadline: string;
  path: PathPaymentQuote['path'];
  pathCount: number;
  sourceAsset: PathPaymentQuote['sourceAsset'];
  destinationAsset: PathPaymentQuote['destinationAsset'];
  reviewedDestinationAmount: string;
  slippageBps: number;
}

function assetKey(asset: { code: string; issuer?: string; type: string }): string {
  return `${asset.type}:${asset.code}:${asset.issuer ?? ''}`;
}

function assertValidSlippage(slippageBps: number): void {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new PathPaymentValidationError(
      'Slippage tolerance must be an integer between 0 and 10000 bps',
      'INVALID_SLIPPAGE',
    );
  }
}

/**
 * Floor on the amount the destination must receive for the payment to be
 * acceptable, given a slippage tolerance in basis points. Stellar amounts have
 * 7 decimal places.
 */
export function computeMinDestinationAmount(
  destinationAmount: string,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
): string {
  const amount = Number(destinationAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new PathPaymentValidationError('Invalid destination amount', 'INVALID_AMOUNT');
  }
  assertValidSlippage(slippageBps);
  return ((amount * (10_000 - slippageBps)) / 10_000).toFixed(7);
}

/** Reject a quote whose expiry is missing, malformed, or already in the past. */
export function assertQuoteNotExpired(quote: PathPaymentQuote, now: Date = new Date()): void {
  const expiresAt = Date.parse(quote.expiresAt);
  if (Number.isNaN(expiresAt)) {
    throw new PathPaymentValidationError('Quote has no valid expiry timestamp', 'QUOTE_NO_EXPIRY');
  }
  if (now.getTime() >= expiresAt) {
    throw new PathPaymentValidationError('Quote expired before submission', 'QUOTE_EXPIRED');
  }
}

/**
 * Freeze the reviewed quote into a {@link QuoteBinding}. Call this at the moment
 * the user approves the quote, then pass the binding to
 * {@link assertQuoteMatchesBinding} before submitting.
 */
export function bindReviewedQuote(
  reviewedQuote: PathPaymentQuote,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
): QuoteBinding {
  assertQuoteNotExpired(reviewedQuote);
  return {
    minDestinationAmount: computeMinDestinationAmount(
      reviewedQuote.destinationAmount,
      slippageBps,
    ),
    deadline: reviewedQuote.expiresAt,
    path: reviewedQuote.path,
    pathCount: reviewedQuote.pathCount,
    sourceAsset: reviewedQuote.sourceAsset,
    destinationAsset: reviewedQuote.destinationAsset,
    reviewedDestinationAmount: reviewedQuote.destinationAmount,
    slippageBps,
  };
}

/**
 * Verify a quote (typically a fresh re-quote taken just before submission) is
 * still consistent with what the user reviewed: same assets, same routing path,
 * not expired, and a delivered amount at or above the bound minimum.
 * Throws {@link PathPaymentValidationError} on any drift.
 */
export function assertQuoteMatchesBinding(
  binding: QuoteBinding,
  quote: PathPaymentQuote,
  now: Date = new Date(),
): void {
  assertQuoteNotExpired(quote, now);

  if (assetKey(quote.sourceAsset) !== assetKey(binding.sourceAsset)) {
    throw new PathPaymentValidationError('Source asset changed since review', 'ASSET_DRIFT');
  }
  if (assetKey(quote.destinationAsset) !== assetKey(binding.destinationAsset)) {
    throw new PathPaymentValidationError(
      'Destination asset changed since review',
      'ASSET_DRIFT',
    );
  }

  const freshPath = quote.path.map(assetKey).join('>');
  const boundPath = binding.path.map(assetKey).join('>');
  if (freshPath !== boundPath || quote.pathCount !== binding.pathCount) {
    throw new PathPaymentValidationError('Payment path changed since review', 'PATH_DRIFT');
  }

  if (Number(quote.destinationAmount) < Number(binding.minDestinationAmount)) {
    throw new PathPaymentValidationError(
      `Delivered amount ${quote.destinationAmount} is below the ${binding.minDestinationAmount} minimum`,
      'SLIPPAGE_EXCEEDED',
    );
  }
}

export async function preparePathPayment(input: {
  plan: SubscriptionPlan;
  sourceAsset: StellarAssetInput;
  sourceAccountPublicKey: string;
}): Promise<PreparedPayment> {
  const response = await apiClient.post<ApiResponse<PreparedPayment> | PreparedPayment>(
    '/payments/stellar/prepare',
    {
      plan: input.plan,
      sourceAssetCode: input.sourceAsset.code,
      sourceAssetIssuer: input.sourceAsset.issuer,
      sourceAssetType: input.sourceAsset.type,
      sourceAccountPublicKey: input.sourceAccountPublicKey,
    },
  );
  return unwrap(response.data);
}

export async function submitPathPayment(input: {
  paymentId: string;
  signedTransactionXdr: string;
  /**
   * The quote the user reviewed. When supplied, the submission is bound to its
   * slippage floor, deadline, path, and assets (Issue #951) and those bounds
   * are forwarded to the backend.
   */
  reviewedQuote?: PathPaymentQuote;
  /** A fresh re-quote to check against the reviewed one; defaults to reviewedQuote. */
  freshQuote?: PathPaymentQuote;
  slippageBps?: number;
}): Promise<SubmittedPayment> {
  const { paymentId, signedTransactionXdr, reviewedQuote, freshQuote, slippageBps } = input;

  let bounds: { minDestinationAmount: string; deadline: string } | undefined;
  if (reviewedQuote) {
    const binding = bindReviewedQuote(reviewedQuote, slippageBps);
    assertQuoteMatchesBinding(binding, freshQuote ?? reviewedQuote);
    bounds = { minDestinationAmount: binding.minDestinationAmount, deadline: binding.deadline };
  }

  const response = await apiClient.post<ApiResponse<SubmittedPayment> | SubmittedPayment>(
    '/payments/stellar/submit',
    { paymentId, signedTransactionXdr, ...(bounds ?? {}) },
  );
  return unwrap(response.data);
}

export async function getPathPaymentAudits(paymentId?: string): Promise<PathPaymentAuditEntry[]> {
  const params = paymentId ? `?paymentId=${encodeURIComponent(paymentId)}` : '';
  const response = await apiClient.get<
    ApiResponse<PathPaymentAuditEntry[]> | PathPaymentAuditEntry[]
  >(`/payments/stellar/audits${params}`);
  return unwrap(response.data);
}

export async function signTransactionXdr(xdr: string, secret?: string | null): Promise<string> {
  const resolvedSecret = secret ?? (await getStoredSecret());
  if (!resolvedSecret) {
    throw new Error('No Stellar secret key is stored on this device');
  }
  const keypair = StellarSdk.Keypair.fromSecret(resolvedSecret);
  const tx = new StellarSdk.Transaction(
    xdr,
    config.env === 'production' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET,
  );
  tx.sign(keypair);
  return tx.toXDR();
}

const stellarPathPaymentService = {
  preparePathPayment,
  submitPathPayment,
  getPathPaymentAudits,
  signTransactionXdr,
  computeMinDestinationAmount,
  assertQuoteNotExpired,
  bindReviewedQuote,
  assertQuoteMatchesBinding,
};

export default stellarPathPaymentService;
