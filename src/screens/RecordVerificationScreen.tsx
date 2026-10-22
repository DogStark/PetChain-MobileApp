import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { TrustBadge } from '../components/TrustBadge';
import type { MedicalRecord } from '../services/medicalRecordService';
import {
  clearVerificationCache,
  verifyRecord,
  type VerificationResult,
} from '../services/verificationService';

interface Props {
  record: MedicalRecord;
  onClose?: () => void;
}

export const RecordVerificationScreen: React.FC<Props> = ({ record, onClose }) => {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [loading, setLoading] = useState(true);

  const runVerification = useCallback(async () => {
    setLoading(true);
    const res = await verifyRecord(record);
    setResult(res);
    setLoading(false);
  }, [record]);

  useEffect(() => {
    runVerification();
  }, [runVerification]);

  const handleRefresh = async () => {
    await clearVerificationCache(record.id);
    runVerification();
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel="Record verification screen"
    >
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Blockchain Verification
        </Text>
        {onClose && (
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close verification screen"
            style={styles.closeBtn}
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.recordInfo}>
        <Text style={styles.label}>Record ID</Text>
        <Text style={styles.value} accessibilityLabel={`Record ID: ${record.id}`}>
          {record.id}
        </Text>
        <Text style={styles.label}>Type</Text>
        <Text style={styles.value}>{record.type}</Text>
        <Text style={styles.label}>Date</Text>
        <Text style={styles.value}>{record.date}</Text>
      </View>

      {loading ? (
        <ActivityIndicator
          size="large"
          color="#4A90A4"
          accessibilityLabel="Verifying record on blockchain"
          style={styles.spinner}
        />
      ) : result ? (
        <View style={styles.resultSection}>
          <TrustBadge status={result.status} />

          {result.txHash && (
            <View style={styles.row}>
              <Text style={styles.label}>Transaction Hash</Text>
              <Text style={styles.mono} accessibilityLabel={`Transaction hash: ${result.txHash}`}>
                {result.txHash}
              </Text>
            </View>
          )}

          {result.onChainHash && (
            <View style={styles.row}>
              <Text style={styles.label}>On-Chain Hash</Text>
              <Text style={styles.mono}>{result.onChainHash}</Text>
            </View>
          )}

          {result.ledger !== undefined && (
            <View style={styles.row}>
              <Text style={styles.label}>Ledger</Text>
              <Text style={styles.value}>{result.ledger}</Text>
            </View>
          )}

          {result.timestamp && (
            <View style={styles.row}>
              <Text style={styles.label}>Verified At</Text>
              <Text style={styles.value}>{new Date(result.timestamp).toLocaleString()}</Text>
            </View>
          )}

          {result.txDetails && (
            <View style={styles.row}>
              <Text style={styles.label}>Source Account</Text>
              <Text style={styles.mono}>{result.txDetails.sourceAccount ?? '—'}</Text>
            </View>
          )}

          {result.status === 'offline' && (
            <Text style={styles.offlineNote} accessibilityRole="text">
              ⚡ Showing cached result — connect to the internet to re-verify.
            </Text>
          )}
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.refreshBtn}
        onPress={handleRefresh}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Re-verify record on blockchain"
        accessibilityState={{ disabled: loading }}
      >
        <Text style={styles.refreshBtnText}>Re-verify on Chain</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 20, gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  closeBtn: { padding: 8 },
  closeBtnText: { fontSize: 18, color: '#6B7280' },
  recordInfo: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 4 },
  resultSection: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 12 },
  row: { gap: 2 },
  label: { fontSize: 11, fontWeight: '600', color: '#6B7280', textTransform: 'uppercase' },
  value: { fontSize: 14, color: '#111827' },
  mono: { fontSize: 12, color: '#374151', fontFamily: 'monospace' },
  spinner: { marginVertical: 32 },
  offlineNote: { fontSize: 13, color: '#8B5CF6', fontStyle: 'italic' },
  refreshBtn: {
    backgroundColor: '#4A90A4',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  refreshBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
