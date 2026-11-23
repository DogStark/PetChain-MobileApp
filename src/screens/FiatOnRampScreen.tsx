/**
 * FiatOnRampScreen — Stellar SEP-24 Interactive Deposit
 *
 * Flow:
 *  1. User picks currency (USD / EUR) and enters their Stellar wallet address
 *  2. App calls POST /api/anchor/deposit → receives interactiveUrl
 *  3. App opens the URL in a WebView; user completes KYC / bank transfer
 *  4. App polls GET /api/anchor/deposit/:id every 10 s until terminal status
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import apiClient from '../services/apiClient';
import stellarAccountService from '../services/stellarAccountService';
import { recordFiatOnRampTransaction } from '../services/stellarTransactionRegistry';

// ─── Types ───────────────────────────────────────────────────────────────────

type DepositStatus =
  | 'pending_user_transfer_start'
  | 'pending_external'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'completed'
  | 'error'
  | 'refunded';

interface DepositRecord {
  id: string;
  assetCode: string;
  currency: string;
  amountIn?: string;
  amountOut?: string;
  status: DepositStatus;
  stellarTxId?: string;
  createdAt: string;
  updatedAt: string;
}

interface InitiateDepositResponse {
  depositId: string;
  interactiveUrl: string;
  assetCode: string;
  currency: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPPORTED_CURRENCIES = ['USD', 'EUR'] as const;
type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const POLL_INTERVAL_MS = 10_000;

/** Rough per-status estimate shown while a deposit is still in flight. */
const ESTIMATED_COMPLETION_MS: Record<DepositStatus, number> = {
  pending_user_transfer_start: 15 * 60_000,
  pending_external: 10 * 60_000,
  pending_anchor: 5 * 60_000,
  pending_stellar: 60_000,
  completed: 0,
  error: 0,
  refunded: 0,
};

function formatEta(ms: number): string {
  if (ms <= 0) return 'less than a minute';
  const minutes = Math.ceil(ms / 60_000);
  return minutes === 1 ? 'about 1 minute' : `about ${minutes} minutes`;
}

const STATUS_LABELS: Record<DepositStatus, string> = {
  pending_user_transfer_start: 'Waiting for your bank transfer…',
  pending_external: 'Processing your bank transfer…',
  pending_anchor: 'Anchor is processing…',
  pending_stellar: 'Sending to your Stellar wallet…',
  completed: 'Deposit complete!',
  error: 'Deposit failed',
  refunded: 'Deposit refunded',
};

const TERMINAL_STATUSES: DepositStatus[] = ['completed', 'error', 'refunded'];

// ─── Component ───────────────────────────────────────────────────────────────

export default function FiatOnRampScreen() {
  const [walletAddress, setWalletAddress] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [step, setStep] = useState<'form' | 'webview' | 'polling' | 'done'>('form');
  const [loading, setLoading] = useState(false);
  const [deposit, setDeposit] = useState<DepositRecord | null>(null);
  const [interactiveUrl, setInteractiveUrl] = useState('');
  const [webviewVisible, setWebviewVisible] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const walletAddressRef = useRef(walletAddress);
  walletAddressRef.current = walletAddress;

  // ── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Registry + wallet balance ───────────────────────────────────────────
  const recordOnRamp = useCallback(async (record: DepositRecord) => {
    await recordFiatOnRampTransaction({
      depositId: record.id,
      walletAddress: walletAddressRef.current.trim(),
      currency: record.currency,
      assetCode: record.assetCode,
      status: record.status,
      amountIn: record.amountIn,
      amountOut: record.amountOut,
      stellarTxId: record.stellarTxId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }, []);

  const refreshWalletBalance = useCallback(async (address: string) => {
    // Re-reads Horizon so the wallet reflects the deposit immediately.
    await stellarAccountService.getBalance(address);
  }, []);

  // ── Polling ─────────────────────────────────────────────────────────────
  const startPolling = useCallback(
    (depositId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      setPollError(null);

      const poll = async () => {
        try {
          const res = await apiClient.get<DepositRecord>(`/anchor/deposit/${depositId}`);
          const record = res.data;
          setDeposit(record);
          setPollError(null);
          await recordOnRamp(record);

          if (TERMINAL_STATUSES.includes(record.status)) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            if (record.status === 'completed') {
              await refreshWalletBalance(walletAddressRef.current.trim());
            }
            setStep('done');
          }
        } catch (err: unknown) {
          // Transient network errors keep polling; surface the last failure so
          // the user can retry manually if it persists.
          setPollError(err instanceof Error ? err.message : 'Could not check deposit status');
        }
      };

      poll();
      pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    },
    [recordOnRamp, refreshWalletBalance],
  );

  const handleRetryPolling = useCallback(() => {
    if (!deposit) return;
    setStep('polling');
    startPolling(deposit.id);
  }, [deposit, startPolling]);

  // ── Initiate deposit ────────────────────────────────────────────────────
  const handleInitiate = useCallback(async () => {
    if (!walletAddress.trim()) {
      Alert.alert('Missing field', 'Please enter your Stellar wallet address.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiClient.post<InitiateDepositResponse>('/anchor/deposit', {
        walletAddress: walletAddress.trim(),
        currency,
      });

      const { depositId, interactiveUrl: url } = res.data;
      setInteractiveUrl(url);
      const now = new Date().toISOString();
      const initialRecord: DepositRecord = {
        id: depositId,
        assetCode: res.data.assetCode,
        currency: res.data.currency,
        status: 'pending_user_transfer_start',
        createdAt: now,
        updatedAt: now,
      };
      setDeposit(initialRecord);
      await recordOnRamp(initialRecord);
      setStep('webview');
      setWebviewVisible(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start deposit';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  }, [walletAddress, currency, recordOnRamp]);

  // ── WebView closed → start polling ──────────────────────────────────────
  const handleWebviewClose = useCallback(() => {
    setWebviewVisible(false);
    if (deposit) {
      setStep('polling');
      startPolling(deposit.id);
    }
  }, [deposit, startPolling]);

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setDeposit(null);
    setInteractiveUrl('');
    setPollError(null);
    setStep('form');
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Fund Your Wallet</Text>
      <Text style={styles.subtitle}>
        Deposit fiat currency to your Stellar wallet via a trusted anchor.
      </Text>

      {/* ── Form ── */}
      {step === 'form' && (
        <View>
          <Text style={styles.label}>Stellar Wallet Address</Text>
          <TextInput
            style={styles.input}
            value={walletAddress}
            onChangeText={setWalletAddress}
            placeholder="G…"
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Stellar wallet address"
          />

          <Text style={styles.label}>Currency</Text>
          <View style={styles.currencyRow}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.currencyBtn, currency === c && styles.currencyBtnActive]}
                onPress={() => setCurrency(c)}
                accessibilityRole="radio"
                accessibilityState={{ checked: currency === c }}
              >
                <Text
                  style={[styles.currencyBtnText, currency === c && styles.currencyBtnTextActive]}
                >
                  {c}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleInitiate}
            disabled={loading}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Start Deposit</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ── Polling ── */}
      {(step === 'polling' || step === 'webview') && deposit && (
        <View style={styles.statusCard}>
          <ActivityIndicator size="large" color="#4A90A4" style={styles.spinner} />
          <Text style={styles.statusText}>{STATUS_LABELS[deposit.status] ?? 'Processing…'}</Text>
          {deposit.amountIn && (
            <Text style={styles.detail}>
              Amount sent: {deposit.amountIn} {deposit.currency}
            </Text>
          )}
          {deposit.amountOut && (
            <Text style={styles.detail}>
              You will receive: {deposit.amountOut} {deposit.assetCode}
            </Text>
          )}
          {step === 'polling' && !TERMINAL_STATUSES.includes(deposit.status) && (
            <Text style={styles.eta}>
              Estimated completion: {formatEta(ESTIMATED_COMPLETION_MS[deposit.status])}
            </Text>
          )}
          {pollError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>Could not check deposit status: {pollError}</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={handleRetryPolling}
                accessibilityRole="button"
              >
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity style={styles.linkBtn} onPress={() => setWebviewVisible(true)}>
            <Text style={styles.linkBtnText}>Re-open anchor page</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Done ── */}
      {step === 'done' && deposit && (
        <View style={styles.statusCard}>
          <Text
            style={[
              styles.doneTitle,
              deposit.status === 'completed' ? styles.success : styles.errorText,
            ]}
          >
            {STATUS_LABELS[deposit.status]}
          </Text>
          {deposit.amountOut && deposit.status === 'completed' && (
            <Text style={styles.detail}>
              {deposit.amountOut} {deposit.assetCode} sent to your wallet.
            </Text>
          )}
          {deposit.stellarTxId && (
            <Text style={styles.txId} numberOfLines={1} ellipsizeMode="middle">
              Tx: {deposit.stellarTxId}
            </Text>
          )}
          {(deposit.status === 'error' || deposit.status === 'refunded') && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>
                {deposit.status === 'error'
                  ? 'The anchor could not complete this deposit. No funds were credited to your wallet.'
                  : 'The anchor refunded this deposit. Check your bank statement for the returned funds.'}
              </Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={handleRetryPolling}
                accessibilityRole="button"
              >
                <Text style={styles.retryBtnText}>Check status again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={handleReset}
                accessibilityRole="button"
              >
                <Text style={styles.retryBtnText}>Try a new deposit</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity style={styles.button} onPress={handleReset}>
            <Text style={styles.buttonText}>New Deposit</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Anchor WebView Modal ── */}
      <Modal
        visible={webviewVisible}
        animationType="slide"
        onRequestClose={handleWebviewClose}
        accessibilityViewIsModal
      >
        <View style={styles.webviewContainer}>
          <View style={styles.webviewHeader}>
            <Text style={styles.webviewTitle}>Complete Deposit</Text>
            <TouchableOpacity
              onPress={handleWebviewClose}
              accessibilityRole="button"
              accessibilityLabel="Close anchor page"
            >
              <Text style={styles.closeBtn}>Done</Text>
            </TouchableOpacity>
          </View>
          {interactiveUrl ? (
            <WebView
              source={{ uri: interactiveUrl }}
              style={styles.webview}
              startInLoadingState
              renderLoading={() => (
                <ActivityIndicator style={StyleSheet.absoluteFill} size="large" color="#4A90A4" />
              )}
            />
          ) : null}
        </View>
      </Modal>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 28 },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#111',
  },
  currencyRow: { flexDirection: 'row', gap: 12 },
  currencyBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  currencyBtnActive: { borderColor: '#4A90A4', backgroundColor: '#EBF5F8' },
  currencyBtnText: { fontSize: 15, fontWeight: '600', color: '#667' },
  currencyBtnTextActive: { color: '#4A90A4' },
  button: {
    backgroundColor: '#4A90A4',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  statusCard: {
    backgroundColor: '#F4F8F9',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  spinner: { marginBottom: 16 },
  statusText: { fontSize: 16, fontWeight: '600', color: '#333', textAlign: 'center' },
  detail: { fontSize: 14, color: '#555', marginTop: 8, textAlign: 'center' },
  txId: { fontSize: 11, color: '#888', marginTop: 8, fontFamily: 'monospace', maxWidth: '100%' },
  linkBtn: { marginTop: 20 },
  linkBtnText: { color: '#4A90A4', fontWeight: '600', fontSize: 14 },
  eta: { fontSize: 13, color: '#667', marginTop: 8, textAlign: 'center' },
  errorBox: { marginTop: 16, alignItems: 'center' },
  retryBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#B42318',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  retryBtnText: { color: '#B42318', fontWeight: '700', fontSize: 14 },
  doneTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  success: { color: '#2E7D32' },
  errorText: { color: '#B42318' },
  webviewContainer: { flex: 1, backgroundColor: '#fff' },
  webviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  webviewTitle: { fontSize: 17, fontWeight: '600' },
  closeBtn: { fontSize: 16, color: '#4A90A4', fontWeight: '600' },
  webview: { flex: 1 },
});
