/**
 * subscriptionService — manages premium subscription state via expo-in-app-purchases
 * and syncs status with the backend.
 */

import * as IAP from 'expo-in-app-purchases';

import apiClient from './apiClient';
import type { Subscription } from '../models/Payment';

export const PRODUCT_IDS = {
  monthly: 'petchain_premium_monthly',
  annual: 'petchain_premium_annual',
} as const;

export type ProductId = (typeof PRODUCT_IDS)[keyof typeof PRODUCT_IDS];

export interface SubscriptionStatus {
  isPremium: boolean;
  plan: 'free' | 'premium_monthly' | 'premium_annual';
  expiresAt: string | null;
}

const FREE_STATUS: SubscriptionStatus = { isPremium: false, plan: 'free', expiresAt: null };
export const FREE_PET_LIMIT = 1;

// ─── Backend sync ─────────────────────────────────────────────────────────────

async function syncWithBackend(
  providerTransactionId: string,
  plan: 'premium_monthly' | 'premium_annual',
): Promise<Subscription> {
  const { data: initRes } = await apiClient.post<{ success: boolean; data: { id: string } }>(
    '/payments/initiate',
    { plan, provider: 'apple_iap', providerTransactionId },
  );
  const { data: confirmRes } = await apiClient.post<{
    success: boolean;
    data: { subscription: Subscription };
  }>(`/payments/${initRes.data.id}/confirm`, {});
  return confirmRes.data.subscription;
}

async function fetchBackendStatus(): Promise<SubscriptionStatus> {
  try {
    const { data } = await apiClient.get<{ success: boolean; data: Subscription | null }>(
      '/payments/subscription',
    );
    const sub = data.data;
    if (!sub || sub.status !== 'active') return FREE_STATUS;
    return {
      isPremium: true,
      plan: sub.plan as SubscriptionStatus['plan'],
      expiresAt: sub.currentPeriodEnd,
    };
  } catch {
    return FREE_STATUS;
  }
}

// ─── IAP helpers ──────────────────────────────────────────────────────────────

async function getProducts(): Promise<IAP.IAPItemDetails[]> {
  await IAP.connectAsync();
  const { responseCode, results } = await IAP.getProductsAsync([
    PRODUCT_IDS.monthly,
    PRODUCT_IDS.annual,
  ]);
  if (responseCode !== IAP.IAPResponseCode.OK || !results) return [];
  return results;
}

async function purchasePlan(productId: ProductId): Promise<SubscriptionStatus> {
  await IAP.connectAsync();

  return new Promise((resolve, reject) => {
    IAP.setPurchaseListener(async ({ responseCode, results, errorCode }) => {
      if (responseCode === IAP.IAPResponseCode.OK && results?.length) {
        const purchase = results[0];
        try {
          const plan = productId === PRODUCT_IDS.annual ? 'premium_annual' : 'premium_monthly';
          const sub = await syncWithBackend(
            (purchase as { orderId?: string; transactionId?: string }).orderId ??
              purchase.productId,
            plan,
          );
          await IAP.finishTransactionAsync(purchase, true);
          resolve({
            isPremium: true,
            plan: sub.plan as SubscriptionStatus['plan'],
            expiresAt: sub.currentPeriodEnd,
          });
        } catch (err) {
          reject(err);
        }
      } else if (responseCode === IAP.IAPResponseCode.USER_CANCELED) {
        resolve(FREE_STATUS);
      } else {
        reject(new Error(`Purchase failed: ${errorCode ?? responseCode}`));
      }
    });

    IAP.purchaseItemAsync(productId).catch(reject);
  });
}

async function restorePurchases(): Promise<SubscriptionStatus> {
  await IAP.connectAsync();
  const { responseCode, results } = await IAP.getPurchaseHistoryAsync();
  if (responseCode !== IAP.IAPResponseCode.OK || !results?.length) {
    return fetchBackendStatus();
  }
  // Sync the most recent purchase with backend
  const latest = results[results.length - 1];
  const plan = latest.productId === PRODUCT_IDS.annual ? 'premium_annual' : 'premium_monthly';
  try {
    const sub = await syncWithBackend(
      (latest as { orderId?: string; transactionId?: string }).orderId ?? latest.productId,
      plan,
    );
    return {
      isPremium: true,
      plan: sub.plan as SubscriptionStatus['plan'],
      expiresAt: sub.currentPeriodEnd,
    };
  } catch {
    return fetchBackendStatus();
  }
}

async function disconnect(): Promise<void> {
  await IAP.disconnectAsync();
}

export default {
  getProducts,
  purchasePlan,
  restorePurchases,
  fetchBackendStatus,
  disconnect,
  FREE_PET_LIMIT,
};
