/**
 * Payment service — frontend.
 * FUTURE FEATURE: Connects to the backend payment API.
 * In-app purchase / subscription provider integration is stubbed.
 */

import apiClient from './apiClient';
import type {
  Payment,
  Subscription,
  SubscriptionPlan,
  SubscriptionPlanDetails,
  PaymentProvider,
} from '../models/Payment';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

class PaymentService {
  /**
   * Fetch all available subscription plans from the backend.
   */
  async getPlans(): Promise<SubscriptionPlanDetails[]> {
    const res = await apiClient.get<ApiResponse<SubscriptionPlanDetails[]>>('/payments/plans');
    return res.data.data;
  }

  /**
   * Get the current user's active subscription.
   */
  async getSubscription(): Promise<Subscription | null> {
    const res = await apiClient.get<ApiResponse<Subscription | null>>('/payments/subscription');
    return res.data.data;
  }

  /**
   * Initiate a payment for a subscription plan.
   * Returns a pending Payment that must be confirmed after provider processing.
   */
  async initiatePayment(
    plan: SubscriptionPlan,
    provider: PaymentProvider,
    providerTransactionId?: string,
  ): Promise<Payment> {
    const res = await apiClient.post<ApiResponse<Payment>>('/payments/initiate', {
      plan,
      provider,
      providerTransactionId,
    });
    return res.data.data;
  }

  /**
   * Confirm a payment after the provider has processed it.
   * Activates the subscription on success.
   */
  async confirmPayment(
    paymentId: string,
  ): Promise<{ payment: Payment; subscription: Subscription }> {
    const res = await apiClient.post<ApiResponse<{ payment: Payment; subscription: Subscription }>>(
      `/payments/${paymentId}/confirm`,
      {},
    );
    return res.data.data;
  }

  /**
   * Cancel the current user's subscription at period end.
   */
  async cancelSubscription(): Promise<Subscription> {
    const res = await apiClient.delete<ApiResponse<Subscription>>('/payments/subscription');
    return res.data.data;
  }

  /**
   * Fetch payment history for the current user.
   */
  async getPaymentHistory(): Promise<Payment[]> {
    const res = await apiClient.get<ApiResponse<Payment[]>>('/payments/history');
    return res.data.data;
  }
}

export default new PaymentService();
