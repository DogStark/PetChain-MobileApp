import { randomUUID } from 'crypto';

import * as StellarSdk from '@stellar/stellar-sdk';
import type { Horizon } from '@stellar/stellar-sdk';

import config from '../config';
import paymentService from './paymentService';
import type { Payment, SubscriptionPlan } from '../models/Payment';
import { SUBSCRIPTION_PLANS } from '../models/Payment';

export interface StellarAssetInput {
  code: string;
  issuer?: string;
  type?: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
}

export class PathPaymentPathNotFoundError extends Error {
  constructor(message = 'No conversion path found via DEX') {
    super(message);
    this.name = 'PathPaymentPathNotFoundError';
  }
}

export interface PaymentPathQuote {
  paymentId: string;
  plan: SubscriptionPlan;
  userId: string;
  sourceAsset: {
    code: string;
    issuer?: string;
    type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  };
  destinationAsset: {
    code: 'XLM';
    type: 'native';
  };
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
  quote: PaymentPathQuote;
  transactionXdr: string;
}

export interface SubmittedPaymentResult {
  payment: Payment;
  subscription: ReturnType<typeof paymentService.confirmPayment>['subscription'];
  transactionHash: string;
  quote: PaymentPathQuote;
}

export interface PathPaymentAuditEntry {
  id: string;
  paymentId: string;
  userId: string;
  plan: SubscriptionPlan;
  mode: 'quote' | 'submitted' | 'failed';
  sourceAsset: PaymentPathQuote['sourceAsset'];
  destinationAmount: string;
  sourceAmount: string;
  exchangeRate: string;
  estimatedNetworkFee: string;
  path: PaymentPathQuote['path'];
  pathCount: number;
  fallbackReason?: string;
  transactionHash?: string;
  createdAt: string;
}

interface PathLikeRecord {
  path: Array<{
    asset_code: string;
    asset_issuer: string;
    asset_type: string;
  }>;
  source_amount: string;
  source_asset_type: string;
  source_asset_code: string;
  source_asset_issuer: string;
  destination_amount: string;
  destination_asset_type: string;
  destination_asset_code: string;
  destination_asset_issuer: string;
}

interface HorizonServerLike {
  strictReceivePaths(
    sourceAsset: StellarSdk.Asset,
    destinationAsset: StellarSdk.Asset | StellarSdk.Asset[],
    destinationAmount: string,
  ): { call(): Promise<{ records: PathLikeRecord[] }> };
  strictSendPaths(
    sourceAsset: StellarSdk.Asset,
    sourceAmount: string,
    destination: string | StellarSdk.Asset[],
  ): { call(): Promise<{ records: PathLikeRecord[] }> };
  loadAccount(publicKey: string): Promise<Horizon.HorizonApi.AccountResponse>;
  fetchBaseFee(): Promise<number>;
  submitTransaction(
    transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
  ): Promise<{ hash: string; ledger?: number }>;
}

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === 'mainnet'
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;
const audits = new Map<string, PathPaymentAuditEntry[]>();
const pendingPayments = new Map<
  string,
  {
    userId: string;
    plan: SubscriptionPlan;
    quote: PaymentPathQuote;
    transactionXdr: string;
  }
>();

function getServer(server?: HorizonServerLike): HorizonServerLike {
  if (server) return server;
  return new StellarSdk.Horizon.Server(HORIZON_URL) as unknown as HorizonServerLike;
}

function now(): string {
  return new Date().toISOString();
}

function assetFromInput(input: StellarAssetInput): StellarSdk.Asset {
  const code = input.code.trim().toUpperCase();
  const type = input.type ?? (code === 'XLM' ? 'native' : 'credit_alphanum4');

  if (type === 'native' || code === 'XLM') {
    return StellarSdk.Asset.native();
  }

  if (!input.issuer?.trim()) {
    throw new Error('Asset issuer is required for non-native Stellar assets');
  }

  return new StellarSdk.Asset(code, input.issuer.trim());
}

function assetDescriptor(asset: StellarSdk.Asset): {
  code: string;
  issuer?: string;
  type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
} {
  if (asset.isNative()) {
    return { code: 'XLM', type: 'native' };
  }

  const canonical = asset as unknown as { code: string; issuer: string };
  return {
    code: canonical.code,
    issuer: canonical.issuer,
    type: 'credit_alphanum4',
  };
}

function pathRecordToDescriptor(record: PathLikeRecord): Array<{
  code: string;
  issuer?: string;
  type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
}> {
  return record.path.map((step) => ({
    code: step.asset_code,
    issuer: step.asset_issuer,
    type: step.asset_type as 'native' | 'credit_alphanum4' | 'credit_alphanum12',
  }));
}

function asNumber(value: string): number {
  return Number.parseFloat(value) || 0;
}

function formatXlm(value: string | number): string {
  return Number(value).toFixed(7).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function resolveReceivingAccount(): string {
  const receivingPublicKey = process.env.STELLAR_RECEIVING_PUBLIC_KEY || '';
  const receivingSecret = process.env.STELLAR_RECEIVING_SECRET || '';

  if (receivingPublicKey) return receivingPublicKey;
  if (receivingSecret) {
    return StellarSdk.Keypair.fromSecret(receivingSecret).publicKey();
  }
  throw new Error('STELLAR_RECEIVING_SECRET or STELLAR_RECEIVING_PUBLIC_KEY is required');
}

function recordAudit(entry: Omit<PathPaymentAuditEntry, 'id' | 'createdAt'>): void {
  const list = audits.get(entry.paymentId) ?? [];
  list.push({ ...entry, id: randomUUID(), createdAt: now() });
  audits.set(entry.paymentId, list);
}

export class StellarPathPaymentService {
  constructor(private readonly server: HorizonServerLike = getServer()) {}

  async preparePayment(input: {
    userId: string;
    plan: SubscriptionPlan;
    sourceAsset: StellarAssetInput;
    sourceAccount: string;
  }): Promise<PreparedPayment> {
    const payment = paymentService.initiatePayment({
      userId: input.userId,
      plan: input.plan,
      provider: 'stellar_path',
    });

    const quote = await this.buildQuote({
      paymentId: payment.id,
      userId: input.userId,
      plan: input.plan,
      sourceAsset: assetFromInput(input.sourceAsset),
      sourceAccount: input.sourceAccount,
    });

    const transactionXdr = await this.buildTransaction({
      quote,
      sourceAccount: input.sourceAccount,
      paymentId: payment.id,
    });

    pendingPayments.set(payment.id, {
      userId: input.userId,
      plan: input.plan,
      quote,
      transactionXdr,
    });

    recordAudit({
      paymentId: payment.id,
      userId: input.userId,
      plan: input.plan,
      mode: 'quote',
      sourceAsset: quote.sourceAsset,
      destinationAmount: quote.destinationAmount,
      sourceAmount: quote.sourceAmount,
      exchangeRate: quote.exchangeRate,
      estimatedNetworkFee: quote.estimatedNetworkFee,
      path: quote.path,
      pathCount: quote.pathCount,
      fallbackReason: quote.fallbackReason,
    });

    return { payment, quote, transactionXdr };
  }

  async submitPayment(input: {
    paymentId: string;
    signedTransactionXdr: string;
  }): Promise<SubmittedPaymentResult> {
    const pending = pendingPayments.get(input.paymentId);
    if (!pending) throw new Error('Path payment not found');

    const tx = new StellarSdk.Transaction(input.signedTransactionXdr, NETWORK_PASSPHRASE);
    const submitted = await this.server.submitTransaction(tx);
    const confirmed = paymentService.confirmPayment(input.paymentId);

    recordAudit({
      paymentId: input.paymentId,
      userId: pending.userId,
      plan: pending.plan,
      mode: 'submitted',
      sourceAsset: pending.quote.sourceAsset,
      destinationAmount: pending.quote.destinationAmount,
      sourceAmount: pending.quote.sourceAmount,
      exchangeRate: pending.quote.exchangeRate,
      estimatedNetworkFee: pending.quote.estimatedNetworkFee,
      path: pending.quote.path,
      pathCount: pending.quote.pathCount,
      fallbackReason: pending.quote.fallbackReason,
      transactionHash: submitted.hash,
    });

    pendingPayments.delete(input.paymentId);

    return {
      payment: confirmed.payment,
      subscription: confirmed.subscription,
      transactionHash: submitted.hash,
      quote: pending.quote,
    };
  }

  async findPaymentPath(input: {
    sourceAsset: StellarSdk.Asset;
    destinationAsset: StellarSdk.Asset;
    destinationAmount: string;
  }): Promise<PathLikeRecord> {
    const page = await this.server
      .strictReceivePaths(input.sourceAsset, input.destinationAsset, input.destinationAmount)
      .call();

    if (page.records.length === 0) {
      throw new PathPaymentPathNotFoundError();
    }

    return page.records
      .slice()
      .sort((a, b) => asNumber(a.source_amount) - asNumber(b.source_amount))[0];
  }

  async executePathPayment(input: {
    sourceAccount: string;
    quote: PaymentPathQuote;
    paymentId: string;
  }): Promise<string> {
    const sourceAccount = await this.server.loadAccount(input.sourceAccount);
    const baseFee = await this.server.fetchBaseFee();
    const pathFeeStroops = Number(process.env.STELLAR_PATH_FEE_STROOPS || '100');
    const medianFee = Math.max(baseFee, pathFeeStroops);
    const builder = new StellarSdk.TransactionBuilder(
      sourceAccount as unknown as StellarSdk.Account,
      {
        fee: String(medianFee),
        networkPassphrase: NETWORK_PASSPHRASE,
      },
    );

    const destination = resolveReceivingAccount();
    if (input.quote.mode === 'direct-xlm') {
      builder.addOperation(
        StellarSdk.Operation.payment({
          destination,
          asset: StellarSdk.Asset.native(),
          amount: input.quote.destinationAmount,
        }),
      );
    } else {
      const destMin = this.getMinimumDestinationAmount(input.quote.destinationAmount);
      builder.addOperation(
        StellarSdk.Operation.pathPaymentStrictSend({
          sendAsset: assetFromInput(input.quote.sourceAsset),
          sendAmount: input.quote.sourceAmount,
          destination,
          destAsset: StellarSdk.Asset.native(),
          destMin,
          path: input.quote.path.map((step) =>
            step.type === 'native'
              ? StellarSdk.Asset.native()
              : new StellarSdk.Asset(step.code, step.issuer ?? ''),
          ),
        } as any),
      );
    }

    const tx = builder
      .addMemo(StellarSdk.Memo.text(input.paymentId.slice(0, 28)))
      .setTimeout(60)
      .build();
    return tx.toXDR();
  }

  getAudits(paymentId?: string): PathPaymentAuditEntry[] {
    if (!paymentId) return [...audits.values()].flat();
    return audits.get(paymentId) ?? [];
  }

  private async buildQuote(input: {
    paymentId: string;
    userId: string;
    plan: SubscriptionPlan;
    sourceAsset: StellarSdk.Asset;
    sourceAccount: string;
  }): Promise<PaymentPathQuote> {
    const receivingAccount = resolveReceivingAccount();
    const receivingAsset = StellarSdk.Asset.native();
    const destinationAmount = this.getDestinationAmount(input.plan);
    const sourceAssetDescriptor = assetDescriptor(input.sourceAsset);

    try {
      const best = await this.findPaymentPath({
        sourceAsset: input.sourceAsset,
        destinationAsset: receivingAsset,
        destinationAmount,
      });
      const path = pathRecordToDescriptor(best);
      const sourceAmount = best.source_amount;
      const fee = this.estimateFee();

      return {
        paymentId: input.paymentId,
        plan: input.plan,
        userId: input.userId,
        sourceAsset: sourceAssetDescriptor,
        destinationAsset: { code: 'XLM', type: 'native' },
        destinationAmount,
        sourceAmount,
        exchangeRate: formatXlm(
          asNumber(sourceAmount) / Math.max(asNumber(destinationAmount), 0.0000001),
        ),
        estimatedNetworkFee: fee,
        mode: 'path',
        path,
        pathCount: best.path.length,
        createdAt: now(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
    } catch (error) {
      if (error instanceof PathPaymentPathNotFoundError) {
        return this.buildDirectXlmFallback({
          paymentId: input.paymentId,
          userId: input.userId,
          plan: input.plan,
          sourceAsset: input.sourceAsset,
          destinationAmount,
          receivingAccount,
          fallbackReason: error.message,
        });
      }

      return this.buildDirectXlmFallback({
        paymentId: input.paymentId,
        userId: input.userId,
        plan: input.plan,
        sourceAsset: input.sourceAsset,
        destinationAmount,
        receivingAccount,
        fallbackReason: error instanceof Error ? error.message : 'Path not found',
      });
    }
  }

  private async buildDirectXlmFallback(input: {
    paymentId: string;
    userId: string;
    plan: SubscriptionPlan;
    sourceAsset: StellarSdk.Asset;
    destinationAmount: string;
    receivingAccount: string;
    fallbackReason: string;
  }): Promise<PaymentPathQuote> {
    let best: PathLikeRecord | undefined;
    try {
      const page = await this.server
        .strictSendPaths(StellarSdk.Asset.native(), input.destinationAmount, input.receivingAccount)
        .call();
      best = page.records[0];
    } catch {
      best = undefined;
    }

    const sourceAmount = best?.source_amount ?? input.destinationAmount;

    return {
      paymentId: input.paymentId,
      plan: input.plan,
      userId: input.userId,
      sourceAsset: assetDescriptor(input.sourceAsset),
      destinationAsset: { code: 'XLM', type: 'native' },
      destinationAmount: input.destinationAmount,
      sourceAmount,
      exchangeRate: formatXlm(
        asNumber(sourceAmount) / Math.max(asNumber(input.destinationAmount), 0.0000001),
      ),
      estimatedNetworkFee: this.estimateFee(),
      mode: 'direct-xlm',
      path: best ? pathRecordToDescriptor(best) : [],
      pathCount: best?.path.length ?? 0,
      fallbackReason: input.fallbackReason,
      createdAt: now(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  private async buildTransaction(input: {
    quote: PaymentPathQuote;
    sourceAccount: string;
    paymentId: string;
  }): Promise<string> {
    return this.executePathPayment(input);
  }

  private getDestinationAmount(plan: SubscriptionPlan): string {
    const amount =
      plan === 'premium_annual'
        ? SUBSCRIPTION_PLANS[plan].priceAnnual
        : SUBSCRIPTION_PLANS[plan].priceMonthly;
    return amount.toFixed(2);
  }

  private estimateFee(): string {
    const pathFeeStroops = Number(process.env.STELLAR_PATH_FEE_STROOPS || '100');
    return (pathFeeStroops / 10_000_000).toFixed(7);
  }

  private getMinimumDestinationAmount(destinationAmount: string): string {
    const amount = asNumber(destinationAmount);
    return Math.max(0, amount * 0.995).toFixed(7);
  }
}

export const stellarPathPaymentService = new StellarPathPaymentService();
export default stellarPathPaymentService;
