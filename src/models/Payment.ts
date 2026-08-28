/**
 * Payment models for the mobile app.
 * FUTURE FEATURE — architecture in place, not connected to a live provider.
 */

export type SubscriptionPlan = 'free' | 'premium_monthly' | 'premium_annual';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled';
export type PaymentProvider = 'stripe' | 'apple_iap' | 'google_play' | 'stub' | 'stellar_path';
export type SubscriptionStatus = 'active' | 'inactive' | 'cancelled' | 'past_due' | 'trialing';

export interface SubscriptionPlanDetails {
  id: SubscriptionPlan;
  name: string;
  description: string;
  priceMonthly: number;
  priceAnnual: number;
  currency: string;
  features: string[];
}

export interface Payment {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: PaymentProvider;
  providerTransactionId?: string;
  plan: SubscriptionPlan;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  provider: PaymentProvider;
  createdAt: string;
  updatedAt: string;
}
