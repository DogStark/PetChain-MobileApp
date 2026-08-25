import * as StellarSdk from '@stellar/stellar-sdk';

import apiClient from './apiClient';
import { getStoredSecret } from './stellarAccountService';
import { getStellarNetworkProfile } from '../config/stellarNetwork';
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
}): Promise<SubmittedPayment> {
  const response = await apiClient.post<ApiResponse<SubmittedPayment> | SubmittedPayment>(
    '/payments/stellar/submit',
    input,
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
  // Issue #943: the passphrase comes from the one validated profile, so the
  // network a transaction is *signed for* can no longer differ from the network
  // it is submitted to.
  const { networkPassphrase } = getStellarNetworkProfile();
  const tx = new StellarSdk.Transaction(xdr, networkPassphrase);
  tx.sign(keypair);
  return tx.toXDR();
}

const stellarPathPaymentService = {
  preparePathPayment,
  submitPathPayment,
  getPathPaymentAudits,
  signTransactionXdr,
};

export default stellarPathPaymentService;
