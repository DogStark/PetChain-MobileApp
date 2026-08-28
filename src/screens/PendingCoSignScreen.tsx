/**
 * PendingCoSignScreen
 *
 * Displays canonical transaction details for co-signer review.
 * Validates payload, initiator, network, sequence, and expiry before
 * allowing approval. Rejects altered or stale requests.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useI18n } from '../i18n';
import type { RootStackScreenProps } from '../navigation/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoSignPayload {
  txId: string;
  initiator: string;
  network: string;
  sequence: number;
  expiresAt: number; // Unix ms
  operations: Array<{ type: string; amount?: string; destination?: string }>;
  payloadHash: string;
}

export type CoSignVerificationError =
  | 'EXPIRED'
  | 'NETWORK_MISMATCH'
  | 'SEQUENCE_INVALID'
  | 'PAYLOAD_ALTERED'
  | 'MISSING_FIELDS';

export interface VerificationResult {
  valid: boolean;
  error?: CoSignVerificationError;
}

// ─── Verification logic (pure, exported for tests) ───────────────────────────

export const EXPECTED_NETWORK = 'petchain-mainnet';

export function verifyCoSignPayload(
  payload: CoSignPayload,
  expectedSequence: number,
  now: number = Date.now(),
): VerificationResult {
  if (
    !payload.txId ||
    !payload.initiator ||
    !payload.network ||
    payload.sequence == null ||
    !payload.expiresAt ||
    !payload.payloadHash ||
    !Array.isArray(payload.operations)
  ) {
    return { valid: false, error: 'MISSING_FIELDS' };
  }

  if (now >= payload.expiresAt) {
    return { valid: false, error: 'EXPIRED' };
  }

  if (payload.network !== EXPECTED_NETWORK) {
    return { valid: false, error: 'NETWORK_MISMATCH' };
  }

  if (payload.sequence !== expectedSequence) {
    return { valid: false, error: 'SEQUENCE_INVALID' };
  }

  const canonical = buildCanonicalString(payload);
  const recomputedHash = simpleHash(canonical);
  if (recomputedHash !== payload.payloadHash) {
    return { valid: false, error: 'PAYLOAD_ALTERED' };
  }

  return { valid: true };
}

/** Deterministic canonical string from immutable tx fields. */
export function buildCanonicalString(payload: CoSignPayload): string {
  return JSON.stringify({
    txId: payload.txId,
    initiator: payload.initiator,
    network: payload.network,
    sequence: payload.sequence,
    expiresAt: payload.expiresAt,
    operations: payload.operations,
  });
}

/**
 * Lightweight deterministic hash (djb2) — sufficient for tamper detection
 * in this context. Not a cryptographic primitive.
 */
export function simpleHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h.toString(16).padStart(8, '0');
}

// ─── Screen ───────────────────────────────────────────────────────────────────

type Props = RootStackScreenProps<'PendingCoSign'>;

const PendingCoSignScreen: React.FC<Props> = ({ route, navigation }) => {
  const { t } = useI18n();
  const { payload, expectedSequence } = route.params;

  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [approving, setApproving] = useState(false);

  // ── Verify on mount ────────────────────────────────────────────────────────

  useEffect(() => {
    const result = verifyCoSignPayload(payload, expectedSequence);
    setVerification(result);

    if (!result.valid) {
      AccessibilityInfo.announceForAccessibility(
        t('pendingCoSign.verificationFailed', { error: result.error ?? '' }),
      );
    }
  }, [payload, expectedSequence, t]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleApprove = useCallback(async () => {
    if (!verification?.valid) return;
    setApproving(true);
    try {
      // Approval is handled by the caller via navigation param callback
      route.params.onApprove(payload);
      navigation.goBack();
    } catch {
      Alert.alert(t('common.error'), t('pendingCoSign.approveError'));
    } finally {
      setApproving(false);
    }
  }, [verification, payload, route.params, navigation, t]);

  const handleReject = useCallback(() => {
    Alert.alert(t('pendingCoSign.rejectTitle'), t('pendingCoSign.rejectConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('pendingCoSign.rejectAction'),
        style: 'destructive',
        onPress: () => {
          route.params.onReject(payload.txId);
          navigation.goBack();
        },
      },
    ]);
  }, [payload.txId, route.params, navigation, t]);

  // ── Loading state ──────────────────────────────────────────────────────────

  if (!verification) {
    return (
      <View style={styles.centered} accessibilityLabel={t('pendingCoSign.verifying')}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>{t('pendingCoSign.verifying')}</Text>
      </View>
    );
  }

  // ── Invalid / rejected state ───────────────────────────────────────────────

  if (!verification.valid) {
    return (
      <View style={styles.centered} accessibilityRole="alert">
        <Text style={styles.errorIcon}>⛔</Text>
        <Text style={styles.errorTitle}>{t('pendingCoSign.invalidTitle')}</Text>
        <Text style={styles.errorMessage}>
          {t(`pendingCoSign.error_${verification.error}` as any)}
        </Text>
        <TouchableOpacity
          style={styles.rejectButton}
          onPress={() => {
            route.params.onReject(payload.txId);
            navigation.goBack();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('pendingCoSign.dismissInvalid')}
        >
          <Text style={styles.rejectButtonText}>{t('pendingCoSign.dismissInvalid')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Valid — show canonical details ─────────────────────────────────────────

  const expiresIn = Math.max(0, Math.floor((payload.expiresAt - Date.now()) / 1000));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel={t('pendingCoSign.screenLabel')}
    >
      <Text style={styles.heading}>{t('pendingCoSign.title')}</Text>
      <Text style={styles.subheading}>{t('pendingCoSign.subtitle')}</Text>

      {/* Transaction details */}
      <View style={styles.card} accessibilityRole="summary">
        <DetailRow label={t('pendingCoSign.txId')} value={payload.txId} />
        <DetailRow label={t('pendingCoSign.initiator')} value={payload.initiator} />
        <DetailRow label={t('pendingCoSign.network')} value={payload.network} />
        <DetailRow label={t('pendingCoSign.sequence')} value={String(payload.sequence)} />
        <DetailRow
          label={t('pendingCoSign.expiresIn')}
          value={t('pendingCoSign.expiresInValue', { seconds: expiresIn })}
          highlight={expiresIn < 60}
        />
      </View>

      {/* Operations */}
      <Text style={styles.sectionTitle}>{t('pendingCoSign.operations')}</Text>
      {payload.operations.map((op, i) => (
        <View key={i} style={styles.opCard} accessibilityRole="text">
          <Text style={styles.opType}>{op.type}</Text>
          {op.destination && (
            <Text style={styles.opDetail}>→ {op.destination}</Text>
          )}
          {op.amount && (
            <Text style={styles.opDetail}>{op.amount}</Text>
          )}
        </View>
      ))}

      {/* Payload hash */}
      <Text style={styles.hashLabel}>{t('pendingCoSign.payloadHash')}</Text>
      <Text style={styles.hashValue} accessibilityLabel={t('pendingCoSign.payloadHash')}>
        {payload.payloadHash}
      </Text>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.rejectButton}
          onPress={handleReject}
          accessibilityRole="button"
          accessibilityLabel={t('pendingCoSign.rejectAction')}
          disabled={approving}
        >
          <Text style={styles.rejectButtonText}>{t('pendingCoSign.rejectAction')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.approveButton, approving && styles.buttonDisabled]}
          onPress={() => void handleApprove()}
          accessibilityRole="button"
          accessibilityLabel={t('pendingCoSign.approveAction')}
          disabled={approving}
        >
          {approving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.approveButtonText}>{t('pendingCoSign.approveAction')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

// ─── Sub-component ────────────────────────────────────────────────────────────

const DetailRow: React.FC<{ label: string; value: string; highlight?: boolean }> = ({
  label,
  value,
  highlight,
}) => (
  <View style={styles.row} accessibilityRole="text">
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={[styles.rowValue, highlight && styles.rowValueHighlight]}>{value}</Text>
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 18, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  heading: { fontSize: 22, fontWeight: '700', color: '#111', marginBottom: 4 },
  subheading: { fontSize: 13, color: '#666', marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  rowLabel: { fontSize: 13, color: '#888', flex: 1 },
  rowValue: { fontSize: 13, color: '#111', fontWeight: '600', flex: 2, textAlign: 'right' },
  rowValueHighlight: { color: '#E53935' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 8 },
  opCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  opType: { fontSize: 13, fontWeight: '700', color: '#333', textTransform: 'uppercase' },
  opDetail: { fontSize: 12, color: '#666', marginTop: 2 },
  hashLabel: { fontSize: 11, color: '#aaa', marginTop: 16, marginBottom: 2 },
  hashValue: { fontSize: 11, color: '#555', fontFamily: 'monospace', marginBottom: 24 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  rejectButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E53935',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  rejectButtonText: { color: '#E53935', fontWeight: '700', fontSize: 15 },
  approveButton: {
    flex: 1,
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  approveButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  buttonDisabled: { backgroundColor: '#A5D6A7' },
  errorIcon: { fontSize: 48, marginBottom: 12 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#E53935', marginBottom: 8 },
  errorMessage: { fontSize: 14, color: '#555', textAlign: 'center', marginBottom: 24 },
});

export default PendingCoSignScreen;
