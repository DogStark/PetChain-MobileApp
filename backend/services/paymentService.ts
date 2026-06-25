/**
 * Payment service — backend.
 * Handles Stripe integration with proper payment processing,
 * refund logic, and idempotency for production reliability.
 */

import { randomUUID } from 'crypto';
import Stripe from 'stripe';

import type {
  CreatePaymentInput,
  Payment,
  Subscription,
  SubscriptionPlan,
} from '../models/Payment';
import { SUBSCRIPTION_PLANS } from '../models/Payment';

// Initialize Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-11-20',
});

// In-memory stores for now (replace with database queries in production)
const payments = new Map<string, Payment>();
const subscriptions = new Map<string, Subscription>();
const idempotencyKeys = new Map<string, string>(); // idempotencyKey -> paymentId

const REFUND_WINDOW_DAYS = 30;

function now(): string {
  return new Date().toISOString();
}

function periodEnd(plan: SubscriptionPlan): string {
  const d = new Date();
  if (plan === 'premium_annual') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString();
}

/**
 * Returns all available subscription plans.
 */
function getPlans() {
  return Object.values(SUBSCRIPTION_PLANS);
}

/**
 * Returns the active subscription for a user, or null if none.
 */
function getSubscription(userId: string): Subscription | null {
  for (const sub of subscriptions.values()) {
    if (sub.userId === userId && sub.status === 'active') return sub;
  }
  return null;
}

/**
 * Create a payment intent with Stripe.
 * Uses idempotency key to prevent duplicate charges.
 * Returns a pending Payment record.
 */
async function createPaymentIntent(
  input: CreatePaymentInput,
  idempotencyKey: string,
): Promise<Payment> {
  // Check idempotency: if this key exists, return the existing payment
  const existingPaymentId = idempotencyKeys.get(idempotencyKey);
  if (existingPaymentId) {
    const existingPayment = payments.get(existingPaymentId);
    if (existingPayment) {
      return existingPayment;
    }
  }

  const amount = SUBSCRIPTION_PLANS[input.plan].priceMonthly;

  // Create Stripe payment intent
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      metadata: {
        userId: input.userId,
        plan: input.plan,
        provider: input.provider,
      },
    },
    {
      idempotencyKey,
    },
  );

  // Create local Payment record
  const t = now();
  const payment: Payment = {
    id: randomUUID(),
    userId: input.userId,
    amount:
      input.plan === 'premium_annual'
        ? SUBSCRIPTION_PLANS[input.plan].priceAnnual
        : SUBSCRIPTION_PLANS[input.plan].priceMonthly,
    currency: 'USD',
    status: 'pending',
    provider: input.provider,
    providerTransactionId: paymentIntent.id,
    plan: input.plan,
    createdAt: t,
    updatedAt: t,
  };

  payments.set(payment.id, payment);
  idempotencyKeys.set(idempotencyKey, payment.id);

  return payment;
}

/**
 * Confirm payment by processing the Stripe payment intent.
 * Verifies intent succeeded, then activates subscription.
 */
async function confirmPayment(paymentId: string): Promise<{ payment: Payment; subscription: Subscription }> {
  const payment = payments.get(paymentId);
  if (!payment) {
    throw new Error('Payment not found');
  }
  if (payment.status !== 'pending') {
    throw new Error('Payment already processed');
  }
  if (!payment.providerTransactionId) {
    throw new Error('No Stripe payment intent found');
  }

  // Retrieve and verify Stripe payment intent
  const paymentIntent = await stripe.paymentIntents.retrieve(payment.providerTransactionId);

  if (paymentIntent.status !== 'succeeded') {
    const t = now();
    payment.status = 'failed';
    payment.updatedAt = t;
    payments.set(paymentId, payment);
    throw new Error(`Payment intent failed: ${paymentIntent.status}`);
  }

  // Mark payment as completed
  const t = now();
  payment.status = 'completed';
  payment.updatedAt = t;
  payments.set(paymentId, payment);

  // Cancel any existing active subscription for this user
  for (const sub of subscriptions.values()) {
    if (sub.userId === payment.userId && sub.status === 'active') {
      sub.status = 'cancelled';
      sub.updatedAt = t;
      subscriptions.set(sub.id, sub);
    }
  }

  // Create and activate new subscription
  const subscription: Subscription = {
    id: randomUUID(),
    userId: payment.userId,
    plan: payment.plan,
    status: 'active',
    currentPeriodStart: t,
    currentPeriodEnd: periodEnd(payment.plan),
    cancelAtPeriodEnd: false,
    provider: payment.provider,
    createdAt: t,
    updatedAt: t,
  };
  subscriptions.set(subscription.id, subscription);

  return { payment, subscription };
}

/**
 * Refund a payment within 30 days of creation.
 * Rejects refunds after 30 days.
 */
async function refundPayment(paymentId: string): Promise<Payment> {
  const payment = payments.get(paymentId);
  if (!payment) {
    throw new Error('Payment not found');
  }
  if (payment.status !== 'completed') {
    throw new Error('Only completed payments can be refunded');
  }
  if (!payment.providerTransactionId) {
    throw new Error('No Stripe payment intent found for refund');
  }

  // Check 30-day refund window
  const createdDate = new Date(payment.createdAt);
  const now_date = new Date();
  const daysSinceCreation = Math.floor((now_date.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSinceCreation > REFUND_WINDOW_DAYS) {
    throw new Error(`Refunds only available within ${REFUND_WINDOW_DAYS} days of purchase`);
  }

  // Process refund with Stripe
  const refund = await stripe.refunds.create({
    payment_intent: payment.providerTransactionId,
  });

  if (refund.status !== 'succeeded') {
    throw new Error(`Refund failed: ${refund.status}`);
  }

  // Update payment status
  const t = now();
  payment.status = 'refunded';
  payment.updatedAt = t;
  payments.set(paymentId, payment);

  // Cancel active subscription if present
  for (const sub of subscriptions.values()) {
    if (sub.userId === payment.userId && sub.status === 'active') {
      sub.status = 'cancelled';
      sub.updatedAt = t;
      subscriptions.set(sub.id, sub);
    }
  }

  return payment;
}

/**
 * Get payment history for a user.
 */
function getPaymentHistory(userId: string): Payment[] {
  return [...payments.values()]
    .filter((p) => p.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Cancel subscription at period end.
 */
function cancelSubscription(userId: string): Subscription {
  const sub = getSubscription(userId);
  if (!sub) throw new Error('No active subscription found');

  const t = now();
  sub.cancelAtPeriodEnd = true;
  sub.updatedAt = t;
  subscriptions.set(sub.id, sub);
  return sub;
}

export default {
  getPlans,
  getSubscription,
  createPaymentIntent,
  confirmPayment,
  refundPayment,
  getPaymentHistory,
  cancelSubscription,
};
