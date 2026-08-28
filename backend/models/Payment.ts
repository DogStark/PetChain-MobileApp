/**
 * Payment and subscription models for PetChain premium features.
 * NOTE: This feature is marked as FUTURE — architecture is in place but
 * actual payment processing is stubbed and not connected to a live provider.
 */

export type SubscriptionPlan = 'free' | 'premium_monthly' | 'premium_annual';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled';
export type PaymentProvider = 'stripe' | 'apple_iap' | 'google_play' | 'stub' | 'stellar_path';
export type SubscriptionStatus = 'active' | 'inactive' | 'cancelled' | 'past_due' | 'trialing';

export interface SubscriptionPlanDetails {
  id: SubscriptionPlan;
  name: string;
  description: string;
  priceMonthly: string;
  priceAnnual: string;
  currency: string;
  features: string[];
}

export interface Payment {
  id: string;
  userId: string;
  amount: string;
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
  providerSubscriptionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentInput {
  userId: string;
  plan: SubscriptionPlan;
  provider: PaymentProvider;
  providerTransactionId?: string;
}

export interface CreateSubscriptionInput {
  userId: string;
  plan: SubscriptionPlan;
  provider: PaymentProvider;
  providerSubscriptionId?: string;
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlan, SubscriptionPlanDetails> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Basic pet management for everyone',
    priceMonthly: '0.00',
    priceAnnual: '0.00',
    currency: 'USD',
    features: ['Up to 2 pets', 'Basic health records', 'Appointment reminders'],
  },
  premium_monthly: {
    id: 'premium_monthly',
    name: 'Premium Monthly',
    description: 'Full access to all PetChain features, billed monthly',
    priceMonthly: '9.99',
    priceAnnual: '119.88',
    currency: 'USD',
    features: [
      'Unlimited pets',
      'Advanced health analytics',
      'Medication tracking',
      'QR pet profiles',
      'Community access',
      'Priority support',
    ],
  },
  premium_annual: {
    id: 'premium_annual',
    name: 'Premium Annual',
    description: 'Full access to all PetChain features, billed annually (save 20%)',
    priceMonthly: '7.99',
    priceAnnual: '95.88',
    currency: 'USD',
    features: [
      'Unlimited pets',
      'Advanced health analytics',
      'Medication tracking',
      'QR pet profiles',
      'Community access',
      'Priority support',
      '20% savings vs monthly',
    ],
  },
};
