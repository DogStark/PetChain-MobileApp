import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import auditTrailService, { type AuditTrailEntry } from '../services/auditTrailService';
import { formatRelativeTime } from '../utils/dateLocale';
import { useSecureScreen } from '../utils/secureScreen';

interface Props {
  entityType: 'pet' | 'medication' | 'appointment';
  entityId: string;
  title?: string;
  onBack: () => void;
}

function prettyDiff(entry: AuditTrailEntry): string {
  const before = entry.beforeData ?? {};
  const after = entry.afterData ?? {};

  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  if (!keys.length) return 'No field changes captured.';

  return keys
    .map((k) => {
      const b = k in before ? JSON.stringify(before[k]) : '∅';
      const a = k in after ? JSON.stringify(after[k]) : '∅';
      return `${k}: ${b} → ${a}`;
    })
    .join('\n');
}

const AuditHistoryScreen: React.FC<Props> = ({ entityType, entityId, title, onBack }) => {
  useSecureScreen();

  const [rows, setRows] = useState<AuditTrailEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const headerTitle = useMemo(() => title ?? 'Audit History', [title]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await auditTrailService.getAuditTrail({ entityType, entityId, limit: 200 });
      setRows(data);
    } catch {
      Alert.alert('Error', 'Failed to load audit history.');
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = async () => {
    try {
      const csv = await auditTrailService.exportAuditTrailCsv({ entityType, entityId });
      await Share.share({ message: csv });
    } catch {
      Alert.alert('Error', 'Failed to export audit history.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <TouchableOpacity
          onPress={handleExport}
          style={styles.exportBtn}
          accessibilityRole="button"
          accessibilityLabel="Export audit history"
          accessibilityHint="Exports audit log as CSV to share"
        >
          <Text style={styles.exportBtnText}>Export</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {loading && <Text style={styles.muted}>Loading…</Text>}
        {!loading && rows.length === 0 && (
          <Text style={styles.muted}>No audit history available yet.</Text>
        )}

        {rows.map((r) => (
          <View key={r.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.action}>{r.action}</Text>
              <Text style={styles.time}>{formatRelativeTime(r.createdAt)}</Text>
            </View>
            <Text style={styles.meta}>
              {r.changedBy ? `User: ${r.changedBy}` : 'User: (system/unknown)'}
            </Text>
            <Text style={styles.diff}>{prettyDiff(r)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 17, color: '#4CAF50' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  exportBtn: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  exportBtnText: { color: '#4CAF50', fontWeight: '700' },
  content: { padding: 16 },
  muted: { color: '#666', paddingVertical: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  action: { fontWeight: '800', color: '#1a1a1a' },
  time: { color: '#666' },
  meta: { color: '#666', marginBottom: 10 },
  diff: { fontFamily: 'monospace', color: '#1a1a1a', lineHeight: 18 },
});

export default AuditHistoryScreen;
