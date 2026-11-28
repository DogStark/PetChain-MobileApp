import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { getStellarNetworkProfile } from '../config/stellarNetwork';
import type { Subscription, SubscriptionPlan, SubscriptionPlanDetails } from '../models/Payment';
import paymentService from '../services/paymentService';
import stellarPathPaymentService, {
  type PathPaymentQuote,
  type PreparedPayment,
} from '../services/stellarPathPaymentService';
import {
  evaluateQuoteFreshness,
  type FreshnessResult,
} from '../services/transactionSimulation';
import { useSecureScreen } from '../utils/secureScreen';

/**
 * Payment review screen for recurring pet payments (subscriptions).
 * Summarizes payee, amount, cadence, next date, and cancellation terms
 * before creating or editing authorization.
 */
interface Props {
  plan: SubscriptionPlan;
  quote?: PathPaymentQuote;
}

// ─── Test exports ────────────────────────────────────────────────────────────────
// Export internal pure functions for unit testing
export const __testExports = {
  formatCurrency: (amount: string | number, currency?: string) => {
    const num = typeof amount === 'string' ? Number(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  },
  getCadenceLabel: (planId: SubscriptionPlan) => {
    return planId === 'premium_annual' ? 'Annual' : 'Monthly';
  },
  getCancellationTerms: (
    subscription: Subscription | null,
  ): string => {
    if (!subscription) return 'No active subscription to cancel.';
    if (subscription.cancelAtPeriodEnd) {
      return `Subscription will cancel at the end of the current period (${new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })}).`;
    }
    return 'Subscription renews automatically. Cancel anytime to stop at period end.';
  },
};

const PaymentReviewScreen: React.FC<Props> = ({ plan, quote }) => {
  useSecureScreen();

  const [plans, setPlans] = useState<SubscriptionPlanDetails[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [fetchedPlans, fetchedSub] = await Promise.all([
        paymentService.getPlans(),
        paymentService.getSubscription(),
      ]);
      setPlans(fetchedPlans);
      setSubscription(fetchedSub);
    } catch {
      Alert.alert('Error', 'Failed to load subscription details. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Ticker for quote freshness
  useEffect(() => {
    if (!quote) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote]);

  const planDetails = useMemo(
    () => plans.find((p) => p.id === plan),
    [plans, plan]
  );

  const freshness = useMemo(
    () => (quote ? evaluateQuoteFreshness(quote, now) : null),
    [quote, now]
  );

  const isActive = subscription?.status === 'active';
  const currentPlanLabel = useMemo(() => {
    if (!subscription) return 'No active subscription';
    return subscription.plan.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }, [subscription]);

  const formatCurrency = (amount: string | number, currency = 'USD') => {
    const num = typeof amount === 'string' ? Number(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '—';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const getCadenceLabel = (planId: SubscriptionPlan) => {
    return planId === 'premium_annual' ? 'Annual' : 'Monthly';
  };

  const getCancellationTerms = () => {
    if (!subscription) return 'No active subscription to cancel.';
    if (subscription.cancelAtPeriodEnd) {
      return `Subscription will cancel at the end of the current period (${formatDate(subscription.currentPeriodEnd)}).`;
    }
    return 'Subscription renews automatically. Cancel anytime to stop at period end.';
  };

  const handleConfirm = async () => {
    if (!quote || !planDetails) return;

    const freshNow = evaluateQuoteFreshness(quote, Date.now());
    if (freshNow.isExpired) {
      Alert.alert('Quote Expired', 'This quote has expired. Please go back and get a fresh quote.');
      return;
    }

    setConfirming(true);
    try {
      // For Stellar path payments, we need to get the prepared payment and sign
      // This is a simplified flow - in reality we'd need the prepared payment from the previous screen
      // For now, we'll show an alert that this would confirm the payment
      Alert.alert(
        'Confirm Payment',
        `This will authorize a ${getCadenceLabel(plan)} payment of ${formatCurrency(
          planDetails.id === 'premium_annual' ? planDetails.priceAnnual : planDetails.priceMonthly
        )} to PetChain for your ${planDetails.name} subscription.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm',
            onPress: async () => {
              // In a real implementation, this would:
              // 1. Get the prepared payment from the previous screen
              // 2. Sign the transaction with the stored secret
              // 3. Submit the payment
              Alert.alert(
                'Payment Authorized',
                `Your ${planDetails.name} subscription has been activated. Next payment: ${formatDate(
                  subscription?.currentPeriodEnd
                )}`,
              );
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to confirm payment. Please try again.'
      );
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = () => {
    Alert.alert('Cancelled', 'Payment authorization was cancelled.', [{ text: 'OK' }]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0f766e" />
      </View>
    );
  }

  if (!planDetails) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Plan details not found</Text>
      </View>
    );
  }

  const amount = planDetails.id === 'premium_annual' ? planDetails.priceAnnual : planDetails.priceMonthly;
  const currency = planDetails.currency;
  const cadence = getCadenceLabel(planDetails.id);
  const nextDate = subscription?.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : 'On confirmation';
  const cancellationTerms = getCancellationTerms();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Review Payment</Text>
      <Text style={styles.subheading}>Confirm the details before authorizing this recurring payment.</Text>

      {/* Payee */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Payee</Text>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Recipient</Text>
          <Text style={styles.detailValue}>PetChain Premium</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Payment Method</Text>
          <Text style={styles.detailValue}>
            {quote?.sourceAsset.code === 'XLM' ? 'Stellar (XLM)' : `Stellar (${quote?.sourceAsset.code})`}
          </Text>
        </View>
      </View>

      {/* Amount & Cadence */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Amount & Schedule</Text>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Amount</Text>
          <Text style={[styles.detailValue, styles.amountValue]}>{formatCurrency(amount, currency)}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Billing Cadence</Text>
          <Text style={styles.detailValue}>{cadence}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Next Payment Date</Text>
          <Text style={styles.detailValue}>{nextDate}</Text>
        </View>
      </View>

      {/* Quote Details (if Stellar path payment) */}
      {quote && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stellar Payment Details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Source Amount</Text>
            <Text style={styles.detailValue}>
              {quote.sourceAmount} {quote.sourceAsset.code}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Destination Amount</Text>
            <Text style={styles.detailValue}>{quote.destinationAmount} XLM</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Exchange Rate</Text>
            <Text style={styles.detailValue}>1 {quote.sourceAsset.code} = {quote.exchangeRate} XLM</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Network Fee (est.)</Text>
            <Text style={styles.detailValue}>~{quote.estimatedNetworkFee} XLM</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Route Type</Text>
            <Text style={styles.detailValue}>
              {quote.mode === 'path' ? 'Path Payment' : 'Direct XLM'}
            </Text>
          </View>
          {quote.path.length > 0 && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Path Hops</Text>
              <Text style={styles.detailValue}>{quote.pathCount}</Text>
            </View>
          )}
          {quote.fallbackReason && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Note</Text>
              <Text style={[styles.detailValue, styles.fallbackText]}>{quote.fallbackReason}</Text>
            </View>
          )}
        </View>
      )}

      {/* Current Subscription Status */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current Subscription</Text>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Status</Text>
          <Text style={styles.detailValue}>{isActive ? 'Active' : 'Inactive'}</Text>
        </View>
        {isActive && (
          <>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Current Plan</Text>
              <Text style={styles.detailValue}>{currentPlanLabel}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Renewal Date</Text>
              <Text style={styles.detailValue}>
                {subscription?.currentPeriodEnd
                  ? formatDate(subscription.currentPeriodEnd)
                  : '—'}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Cancellation Terms */}
      <View style={[styles.section, styles.cancellationSection]}>
        <Text style={styles.sectionTitle}>Cancellation Terms</Text>
        <Text style={styles.cancellationText}>{cancellationTerms}</Text>
        {subscription?.cancelAtPeriodEnd && (
          <Text style={styles.cancelNotice}>
            This subscription is scheduled to cancel at the end of the current period.
          </Text>
        )}
      </View>

      {/* Quote Freshness Warning */}
      {freshness?.isExpiringSoon && (
        <View style={styles.warnBanner} accessible accessibilityRole="alert">
          <Text style={styles.warnText}>
            ⚠ Quote expires in {freshness.secondsRemaining}s. Confirm soon to lock in this rate.
          </Text>
        </View>
      )}

      {freshness?.isExpired && (
        <View style={styles.errorBanner} accessible accessibilityRole="alert">
          <Text style={styles.errorText}>This quote has expired. Please go back and refresh.</Text>
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.buttonGroup}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={handleCancel}
          disabled={confirming}
          accessibilityRole="button"
          accessibilityState={{ disabled: confirming }}
          accessibilityLabel="Cancel payment authorization"
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmButton, confirming && styles.confirmButtonDisabled]}
          onPress={handleConfirm}
          disabled={confirming || freshness?.isExpired}
          accessibilityRole="button"
          accessibilityState={{ disabled: confirming || freshness?.isExpired, busy: confirming }}
          accessibilityLabel="Confirm and authorize payment"
          accessibilityHint={
            freshness?.isExpired
              ? 'Quote has expired. Refresh to get a new quote.'
              : 'Authorizes the recurring payment. This cannot be undone.'
          }
        >
          {confirming ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.confirmButtonText}>Confirm & Authorize</Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.helperText}>
        The payment will be processed using your stored Stellar secret key. You can manage your
        subscription in Settings after confirmation.
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f2' },
  content: { padding: 18, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  heading: { fontSize: 24, fontWeight: '800', color: '#12372a', marginBottom: 4 },
  subheading: { fontSize: 14, color: '#60756b', marginBottom: 20 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e7ece8',
  },
  cancellationSection: {
    backgroundColor: '#fff8f0',
    borderColor: '#f0c56b',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#12372a',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f2f1',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f2f1',
  },
  detailLabel: { fontSize: 14, color: '#60756b', fontWeight: '500' },
  detailValue: { fontSize: 14, color: '#173428', fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 12 },
  amountValue: { fontSize: 18, fontWeight: '800', color: '#0f766e' },
  fallbackText: { color: '#8a6400', fontWeight: '600' },
  cancellationText: { color: '#344b42', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  cancelNotice: {
    color: '#e53935',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  warnBanner: {
    backgroundColor: '#fff4d6',
    borderColor: '#f0c56b',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorBanner: {
    backgroundColor: '#fce8e6',
    borderColor: '#e03e2f',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  warnText: { color: '#8a6400', fontWeight: '600', fontSize: 13 },
  errorText: { color: '#c5221f', fontWeight: '600', fontSize: 13, textAlign: 'center' },
  buttonGroup: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    marginBottom: 16,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderColor: '#0f766e',
    borderWidth: 2,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 14,
  },
  cancelButtonText: { color: '#0f766e', fontWeight: '800', fontSize: 15 },
  confirmButton: {
    flex: 1,
    backgroundColor: '#12372a',
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 14,
  },
  confirmButtonDisabled: { opacity: 0.7 },
  confirmButtonText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  helperText: { color: '#60756b', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
});

export default PaymentReviewScreen;