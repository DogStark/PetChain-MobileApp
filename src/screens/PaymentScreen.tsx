import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { getStellarNetworkProfile } from '../config/stellarNetwork';
import type { Subscription, SubscriptionPlan, SubscriptionPlanDetails } from '../models/Payment';
import paymentService from '../services/paymentService';
import { getPublicKeyFromStoredSecret, getStoredSecret } from '../services/stellarAccountService';
import stellarPathPaymentService, {
  type PathPaymentAuditEntry,
  type PathPaymentQuote,
  type PreparedPayment,
} from '../services/stellarPathPaymentService';
import {
  canSignQuote,
  compareQuoteToSimulation,
  evaluateQuoteFreshness,
  simulateTransactionXdr,
  type Discrepancy,
  type TransactionSimulation,
} from '../services/transactionSimulation';

/**
 * One spoken sentence summarising the transaction, so a screen-reader user gets
 * the same review as a sighted one instead of a stream of separate labels.
 */
function buildReviewAccessibilityLabel(simulation: TransactionSimulation): string {
  const parts = [
    `Network ${simulation.network}`,
    `fee ${simulation.feeXlm} XLM`,
    simulation.memo.type === 'none' ? 'no memo' : `memo ${simulation.memo.value ?? ''}`,
    `${simulation.operationCount} operation${simulation.operationCount === 1 ? '' : 's'}`,
  ];
  for (const op of simulation.operations) {
    const amount = op.destinationAmount ? ` ${op.destinationAmount}` : '';
    const asset = op.destinationAsset ? ` ${op.destinationAsset}` : '';
    parts.push(`${op.type}${amount}${asset}`);
  }
  return `You are signing: ${parts.join(', ')}.`;
}

const PaymentScreen: React.FC = () => {
  const [plans, setPlans] = useState<SubscriptionPlanDetails[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [sourceAssetCode, setSourceAssetCode] = useState('XLM');
  const [sourceAssetIssuer, setSourceAssetIssuer] = useState('');
  const [stellarPublicKey, setStellarPublicKey] = useState<string | null>(null);
  const [preparedPayment, setPreparedPayment] = useState<PreparedPayment | null>(null);
  const [quote, setQuote] = useState<PathPaymentQuote | null>(null);
  const [audits, setAudits] = useState<PathPaymentAuditEntry[]>([]);
  /**
   * Ticks once a second while a quote is on screen so the expiry countdown and
   * the disabled state of the confirm button stay truthful (issue #945).
   */
  const [now, setNow] = useState(() => Date.now());
  /**
   * Synchronous double-submit guard (issue #946). `submitting` is React state,
   * so a second tap in the same frame can still get past `disabled` before the
   * re-render lands. A ref flips immediately.
   */
  const submitLock = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [fetchedPlans, fetchedSub, publicKey] = await Promise.all([
        paymentService.getPlans(),
        paymentService.getSubscription(),
        getPublicKeyFromStoredSecret(),
      ]);
      setPlans(fetchedPlans);
      setSubscription(fetchedSub);
      setStellarPublicKey(publicKey);
    } catch {
      Alert.alert('Error', 'Failed to load subscription plans. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only run the ticker while a quote is actually displayed.
  useEffect(() => {
    if (!quote) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote]);

  const networkProfile = useMemo(() => getStellarNetworkProfile(), []);

  /**
   * Decode the envelope that will actually be signed (issue #945).
   *
   * The previous screen displayed fields from the server-supplied quote and
   * then signed `preparedPayment.transactionXdr` — two different objects, never
   * cross-checked.
   */
  const simulation = useMemo<TransactionSimulation | null>(() => {
    if (!preparedPayment) return null;
    try {
      return simulateTransactionXdr(
        preparedPayment.transactionXdr,
        networkProfile.networkPassphrase,
      );
    } catch {
      return null;
    }
  }, [preparedPayment, networkProfile.networkPassphrase]);

  const discrepancies = useMemo<Discrepancy[]>(() => {
    if (!quote || !simulation) return [];
    return compareQuoteToSimulation(quote, simulation, networkProfile.network);
  }, [quote, simulation, networkProfile.network]);

  const freshness = useMemo(
    () => (quote ? evaluateQuoteFreshness(quote, now) : null),
    [quote, now],
  );

  const signDecision = useMemo(() => {
    if (!freshness) return { allowed: false, reason: 'No quote prepared yet.' };
    if (!simulation) {
      return {
        allowed: false,
        reason: 'This transaction could not be decoded for review, so it will not be signed.',
      };
    }
    return canSignQuote(freshness, discrepancies);
  }, [freshness, simulation, discrepancies]);

  const confirmDisabled = submitting || !signDecision.allowed;

  const currentPrice = useCallback((plan: SubscriptionPlanDetails) => {
    return plan.id === 'premium_annual' ? plan.priceAnnual : plan.priceMonthly;
  }, []);

  const handlePrepareQuote = async (plan: SubscriptionPlan) => {
    const sourceCode = sourceAssetCode.trim().toUpperCase();
    const issuer = sourceAssetIssuer.trim();
    const sourceAccount = stellarPublicKey ?? (await getPublicKeyFromStoredSecret());

    if (!sourceAccount) {
      Alert.alert(
        'Stellar account required',
        'Save a Stellar secret key in Stellar Account before paying with a custom asset.',
      );
      return;
    }

    if (sourceCode !== 'XLM' && !issuer) {
      Alert.alert('Issuer required', 'Enter the issuer public key for non-XLM assets.');
      return;
    }

    setSelectedPlan(plan);
    setPreparing(true);
    try {
      const prepared = await stellarPathPaymentService.preparePathPayment({
        plan,
        sourceAsset: {
          code: sourceCode,
          issuer: sourceCode === 'XLM' ? undefined : issuer,
          type: sourceCode === 'XLM' ? 'native' : 'credit_alphanum4',
        },
        sourceAccountPublicKey: sourceAccount,
      });

      setPreparedPayment(prepared);
      setQuote(prepared.quote);
      setAudits(await stellarPathPaymentService.getPathPaymentAudits(prepared.payment.id));
      Alert.alert(
        'Quote ready',
        prepared.quote.mode === 'path'
          ? 'A conversion path was found. Review the rate and fee before confirming.'
          : 'No conversion path was found, so the quote falls back to a direct XLM payment.',
      );
    } catch (error) {
      Alert.alert(
        'Quote failed',
        error instanceof Error ? error.message : 'Unable to prepare the Stellar payment.',
      );
    } finally {
      setPreparing(false);
    }
  };

  const handleConfirmPayment = async () => {
    if (!preparedPayment || !quote) return;

    // Issue #946: refuse a second entry synchronously. `submitting` state alone
    // leaves a window in which a rapid second tap is still accepted.
    if (submitLock.current) return;

    // Issue #945: re-evaluate at the moment of signing rather than trusting the
    // last render. The ticker may not have fired since the quote lapsed.
    const freshNow = evaluateQuoteFreshness(quote, Date.now());
    const decision = simulation
      ? canSignQuote(freshNow, discrepancies)
      : { allowed: false, reason: 'This transaction could not be decoded for review.' };

    if (!decision.allowed) {
      Alert.alert('Cannot sign', decision.reason ?? 'This quote is no longer valid.');
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    try {
      const secret = await getStoredSecret();
      const signedTransactionXdr = await stellarPathPaymentService.signTransactionXdr(
        preparedPayment.transactionXdr,
        secret,
      );

      const result = await stellarPathPaymentService.submitPathPayment({
        paymentId: preparedPayment.payment.id,
        signedTransactionXdr,
      });

      setSubscription(result.subscription);
      setAudits(await stellarPathPaymentService.getPathPaymentAudits(result.payment.id));
      setPreparedPayment(null);
      setQuote(null);
      Alert.alert(
        'Payment confirmed',
        `Your ${result.payment.plan.replace('_', ' ')} subscription is active. Tx: ${result.transactionHash}`,
      );
    } catch (error) {
      Alert.alert(
        'Payment failed',
        error instanceof Error ? error.message : 'Unable to submit the Stellar payment.',
      );
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  };

  const isActive = subscription?.status === 'active';
  const currentPlanLabel = useMemo(() => {
    if (!subscription) return 'No active subscription';
    return subscription.plan.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }, [subscription]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0f766e" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Premium Plans</Text>
      <Text style={styles.subheading}>Pay with any Stellar asset and convert to XLM on-chain.</Text>

      {stellarPublicKey ? (
        <View style={styles.accountBanner}>
          <Text style={styles.accountBannerLabel}>Signing account</Text>
          <Text style={styles.accountBannerValue} numberOfLines={1}>
            {stellarPublicKey}
          </Text>
        </View>
      ) : (
        <View style={styles.warnBanner}>
          <Text style={styles.warnText}>
            Add a Stellar secret key in Stellar Account to sign the payment transaction locally.
          </Text>
        </View>
      )}

      <View style={styles.quoteCard}>
        <Text style={styles.sectionTitle}>Stellar asset payment</Text>
        <Text style={styles.helperText}>
          Enter the asset you want to pay with. For example: XLM, USDC, or a testnet asset.
        </Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={sourceAssetCode}
            onChangeText={setSourceAssetCode}
            placeholder="Asset code"
            placeholderTextColor="#8f8f8f"
            autoCapitalize="characters"
          />
          <TextInput
            style={styles.input}
            value={sourceAssetIssuer}
            onChangeText={setSourceAssetIssuer}
            placeholder="Issuer public key"
            placeholderTextColor="#8f8f8f"
            autoCapitalize="characters"
          />
        </View>
        <Text style={styles.helperText}>
          If the chosen asset has no conversion path, we automatically fall back to a direct XLM
          payment.
        </Text>
      </View>

      {isActive && (
        <View style={styles.activeCard}>
          <Text style={styles.activeTitle}>Current Plan</Text>
          <Text style={styles.activePlan}>{currentPlanLabel}</Text>
          <Text style={styles.activePeriod}>
            Renews:{' '}
            {subscription?.currentPeriodEnd
              ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
              : ''}
          </Text>
          {subscription?.cancelAtPeriodEnd ? (
            <Text style={styles.cancelNotice}>Cancels at period end</Text>
          ) : null}
        </View>
      )}

      {plans
        .filter((p) => p.id !== 'free')
        .map((plan) => {
          const isSelected = selectedPlan === plan.id;
          const price = currentPrice(plan);
          return (
            <View key={plan.id} style={[styles.planCard, isSelected && styles.planCardActive]}>
              <Text style={styles.planName}>{plan.name}</Text>
              <Text style={styles.planDescription}>{plan.description}</Text>
              <Text style={styles.planPrice}>
                ${price.toFixed(2)}{' '}
                <Text style={styles.planPricePer}>
                  / {plan.id === 'premium_annual' ? 'year' : 'month'}
                </Text>
              </Text>
              {plan.id === 'premium_annual' ? (
                <Text style={styles.savingsLabel}>Save 20% vs monthly</Text>
              ) : null}

              <View style={styles.featureList}>
                {plan.features.map((feature) => (
                  <Text key={feature} style={styles.featureItem}>
                    ✓ {feature}
                  </Text>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.subscribeButton, preparing && styles.subscribeButtonDisabled]}
                onPress={() => void handlePrepareQuote(plan.id)}
                disabled={preparing || submitting}
              >
                {preparing && isSelected ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.subscribeButtonText}>Get Stellar quote</Text>
                )}
              </TouchableOpacity>
            </View>
          );
        })}

      {quote && preparedPayment ? (
        <View style={styles.quoteCard}>
          <Text style={styles.sectionTitle}>Quote preview</Text>
          <Text style={styles.quoteLine}>
            Mode: {quote.mode === 'path' ? 'Path payment' : 'Direct XLM fallback'}
          </Text>
          <Text style={styles.quoteLine}>Destination: {quote.destinationAmount} XLM</Text>
          <Text style={styles.quoteLine}>
            Source: {quote.sourceAmount} {quote.sourceAsset.code}
          </Text>
          <Text style={styles.quoteLine}>Exchange rate: {quote.exchangeRate}</Text>
          <Text style={styles.quoteLine}>Network fee: ~{quote.estimatedNetworkFee} XLM</Text>
          <Text style={styles.quoteLine}>Path hops: {quote.pathCount}</Text>
          {quote.fallbackReason ? (
            <Text style={styles.fallbackText}>{quote.fallbackReason}</Text>
          ) : null}

          <Text style={styles.auditTitle}>Route</Text>
          {quote.path.length > 0 ? (
            quote.path.map((step, index) => (
              <Text key={`${step.code}-${index}`} style={styles.auditLine}>
                {index + 1}. {step.code}
                {step.issuer ? ` (${step.issuer.slice(0, 8)}...)` : ''}
              </Text>
            ))
          ) : (
            <Text style={styles.auditLine}>Direct payment to the treasury account</Text>
          )}

          {/* Issue #945: what the envelope actually does, decoded from the XDR
              about to be signed rather than from the server-supplied quote. */}
          <Text style={styles.auditTitle}>You are signing</Text>
          {simulation ? (
            <View accessible accessibilityLabel={buildReviewAccessibilityLabel(simulation)}>
              <Text style={styles.quoteLine}>Network: {simulation.network}</Text>
              <Text style={styles.quoteLine}>Fee: {simulation.feeXlm} XLM</Text>
              <Text style={styles.quoteLine}>
                Memo:{' '}
                {simulation.memo.type === 'none'
                  ? 'None'
                  : `${simulation.memo.value ?? ''} (${simulation.memo.type})`}
              </Text>
              <Text style={styles.quoteLine}>Operations: {simulation.operationCount}</Text>
              {simulation.operations.map((op) => (
                <Text key={op.index} style={styles.auditLine}>
                  {op.index + 1}. {op.type}
                  {op.destinationAmount ? ` — ${op.destinationAmount}` : ''}
                  {op.destinationAsset ? ` ${op.destinationAsset}` : ''}
                  {op.destination
                    ? ` to ${op.destination.slice(0, 8)}…${op.destination.slice(-4)}`
                    : ''}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={styles.fallbackText}>
              This transaction could not be decoded for review. It will not be signed.
            </Text>
          )}

          {discrepancies.length > 0 ? (
            <View
              style={styles.warnBanner}
              accessible
              accessibilityRole="alert"
              accessibilityLabel={`Warning. ${discrepancies.map((d) => d.message).join(' ')}`}
            >
              {discrepancies.map((d) => (
                <Text key={d.field} style={styles.warnText}>
                  {d.message}
                </Text>
              ))}
            </View>
          ) : null}

          {freshness ? (
            <Text
              style={
                freshness.isExpired || freshness.isExpiringSoon
                  ? styles.fallbackText
                  : styles.quoteLine
              }
              accessibilityLiveRegion={freshness.isExpiringSoon ? 'polite' : 'none'}
            >
              {freshness.isExpired
                ? 'This quote has expired. Refresh it to get a current rate.'
                : `Quote valid for ${freshness.secondsRemaining}s`}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.confirmButton, confirmDisabled && styles.confirmButtonDisabled]}
            onPress={() => void handleConfirmPayment()}
            disabled={confirmDisabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: confirmDisabled, busy: submitting }}
            accessibilityLabel={
              simulation
                ? `Sign and confirm payment of ${quote.sourceAmount} ${quote.sourceAsset.code}`
                : 'Sign and confirm payment'
            }
            accessibilityHint={
              signDecision.allowed
                ? 'Signs the transaction locally and submits it. This cannot be undone.'
                : signDecision.reason
            }
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.confirmButtonText}>Sign and confirm</Text>
            )}
          </TouchableOpacity>

          {!signDecision.allowed && !submitting ? (
            <Text style={styles.fallbackText}>{signDecision.reason}</Text>
          ) : null}

          {freshness?.isExpired && selectedPlan ? (
            <TouchableOpacity
              style={styles.confirmButton}
              onPress={() => void handlePrepareQuote(selectedPlan)}
              disabled={preparing}
              accessibilityRole="button"
              accessibilityState={{ disabled: preparing, busy: preparing }}
              accessibilityLabel="Refresh quote"
            >
              <Text style={styles.confirmButtonText}>
                {preparing ? 'Refreshing…' : 'Refresh quote'}
              </Text>
            </TouchableOpacity>
          ) : null}

          <Text style={styles.helperText}>
            The transaction is signed locally using the stored Stellar secret key and then submitted
            to Horizon.
          </Text>
        </View>
      ) : null}

      {audits.length > 0 ? (
        <View style={styles.quoteCard}>
          <Text style={styles.sectionTitle}>Audit trail</Text>
          {audits.map((entry) => (
            <View key={entry.id} style={styles.auditBlock}>
              <Text style={styles.auditTitle}>
                {entry.mode.toUpperCase()} {entry.plan}
              </Text>
              <Text style={styles.auditLine}>
                Source: {entry.sourceAsset.code} | Dest: {entry.destinationAmount} XLM | Rate:{' '}
                {entry.exchangeRate}
              </Text>
              <Text style={styles.auditLine}>Fee: {entry.estimatedNetworkFee} XLM</Text>
              {entry.fallbackReason ? (
                <Text style={styles.fallbackText}>{entry.fallbackReason}</Text>
              ) : null}
              {entry.transactionHash ? (
                <Text style={styles.auditLine}>Tx: {entry.transactionHash}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f2' },
  content: { padding: 18, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 24, fontWeight: '800', color: '#12372a', marginBottom: 4 },
  subheading: { fontSize: 14, color: '#60756b', marginBottom: 16 },
  accountBanner: {
    backgroundColor: '#12372a',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  accountBannerLabel: {
    color: '#9fd7c7',
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  accountBannerValue: { color: '#fff', marginTop: 6, fontWeight: '600' },
  warnBanner: {
    backgroundColor: '#fff4d6',
    borderColor: '#f0c56b',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  warnText: { color: '#8a6400', fontWeight: '600' },
  quoteCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e7ece8',
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#12372a', marginBottom: 8 },
  helperText: { color: '#60756b', fontSize: 13, lineHeight: 18, marginTop: 8 },
  row: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1,
    backgroundColor: '#f6f8f7',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#173428',
    borderWidth: 1,
    borderColor: '#e4ebe6',
  },
  activeCard: {
    backgroundColor: '#e8f5e9',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#c8e6c9',
  },
  activeTitle: {
    fontSize: 12,
    color: '#2e7d32',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  activePlan: { fontSize: 18, fontWeight: '800', color: '#111', marginBottom: 4 },
  activePeriod: { fontSize: 13, color: '#555' },
  cancelNotice: { fontSize: 13, color: '#e53935', marginTop: 6 },
  planCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e0e5e1',
  },
  planCardActive: { borderColor: '#0f766e', borderWidth: 2 },
  planName: { fontSize: 20, fontWeight: '800', color: '#12372a', marginBottom: 4 },
  planDescription: { fontSize: 13, color: '#60756b', marginBottom: 10 },
  planPrice: { fontSize: 28, fontWeight: '800', color: '#12372a' },
  planPricePer: { fontSize: 14, fontWeight: '500', color: '#60756b' },
  savingsLabel: {
    fontSize: 12,
    color: '#2e7d32',
    fontWeight: '700',
    marginTop: 2,
    marginBottom: 8,
  },
  featureList: { marginTop: 12, marginBottom: 16 },
  featureItem: { fontSize: 13, color: '#344b42', marginBottom: 6 },
  subscribeButton: {
    backgroundColor: '#0f766e',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  subscribeButtonDisabled: { opacity: 0.7 },
  subscribeButtonText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  quoteLine: { color: '#314941', marginBottom: 6, fontWeight: '600' },
  fallbackText: {
    color: '#8a6400',
    backgroundColor: '#fff4d6',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    fontWeight: '600',
  },
  auditTitle: { fontSize: 14, fontWeight: '800', color: '#12372a', marginTop: 12, marginBottom: 8 },
  auditBlock: {
    backgroundColor: '#f8fbf9',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e7ece8',
  },
  auditLine: { color: '#344b42', marginBottom: 4, fontSize: 12 },
  confirmButton: {
    backgroundColor: '#12372a',
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 14,
  },
  confirmButtonDisabled: { opacity: 0.8 },
  confirmButtonText: { color: '#fff', fontWeight: '800' },
});

export default PaymentScreen;
