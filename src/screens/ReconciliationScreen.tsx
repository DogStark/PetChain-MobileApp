/**
 * ReconciliationScreen
 * Issue #102 — Automated Vet Record Reconciliation
 *
 * Shows:
 * - Current reconciliation status (running / last run)
 * - Summary stats (clean / tampered / missing / errors)
 * - Full per-record results with tamper alerts and re-anchor status
 * - Manual "Run Now" trigger
 * - Past reports list
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type {
  ReconciliationReport,
  ReconciliationSummary,
  RecordReconciliationResult,
} from '../models/Reconciliation';
import apiClient from '../services/apiClient';
import {
  runReconciliation,
  getReconciliationSummary,
  listReconciliationReports,
  ReconciliationError,
} from '../services/reconciliationService';

type TrustDecision = 'local' | 'blockchain';

async function writeAuditTrail(record: RecordReconciliationResult, decision: TrustDecision) {
  await apiClient
    .post('/audit-trail', {
      entityType: 'reconciliation_record',
      entityId: record.recordId,
      action: 'UPDATE',
      beforeData: { localHash: record.localHash, onChainHash: record.onChainHash },
      afterData: { decision: decision === 'local' ? 'TRUST_LOCAL' : 'TRUST_BLOCKCHAIN' },
    })
    .catch(() => {});
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

type ScreenView = 'dashboard' | 'report';

// ─── Component ────────────────────────────────────────────────────────────────

const ReconciliationScreen: React.FC<Props> = ({ onBack }) => {
  const [view, setView] = useState<ScreenView>('dashboard');
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);
  const [reports, setReports] = useState<ReconciliationReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, TrustDecision>>({});

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([getReconciliationSummary(), listReconciliationReports()]);
      setSummary(s);
      setReports(r);
    } catch {
      Alert.alert('Error', 'Failed to load reconciliation data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboard();
    setRefreshing(false);
  };

  // ── Manual run ──────────────────────────────────────────────────────────────

  const handleRunNow = () => {
    Alert.alert(
      'Run Reconciliation',
      'This will re-hash all medical records and compare against the blockchain. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Run Now',
          onPress: async () => {
            setRunning(true);
            try {
              const report = await runReconciliation();
              setSelectedReport(report);
              setView('report');
              await loadDashboard();
            } catch (err) {
              const msg =
                err instanceof ReconciliationError
                  ? err.message
                  : 'Reconciliation failed. Please try again.';
              Alert.alert('Error', msg);
            } finally {
              setRunning(false);
            }
          },
        },
      ],
    );
  };

  // ── Reconciliation decisions ─────────────────────────────────────────────────

  const recordDecision = async (record: RecordReconciliationResult, decision: TrustDecision) => {
    setDecisions((prev) => ({ ...prev, [record.recordId]: decision }));
    await writeAuditTrail(record, decision);
  };

  const handleTrustBlockchain = (record: RecordReconciliationResult) => {
    void recordDecision(record, 'blockchain');
  };

  const handleTrustLocal = (record: RecordReconciliationResult) => {
    Alert.alert(
      'Trust Local Record?',
      'This will keep your local copy and overwrite the on-chain verification status. Only do this if you are certain the blockchain entry is wrong.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Trust Local',
          style: 'destructive',
          onPress: () => void recordDecision(record, 'local'),
        },
      ],
    );
  };

  const handleTrustBlockchainForAll = (records: RecordReconciliationResult[]) => {
    const pending = records.filter((r) => !decisions[r.recordId]);
    if (pending.length === 0) return;
    Alert.alert(
      'Trust Blockchain for All?',
      `This will mark all ${pending.length} tampered record(s) as resolved in favor of the on-chain version.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Trust Blockchain for All',
          onPress: () => {
            pending.forEach((r) => void recordDecision(r, 'blockchain'));
          },
        },
      ],
    );
  };

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderResultRow = (item: RecordReconciliationResult, idx: number) => (
    <View key={idx} style={[styles.resultRow, statusRowStyle(item.status)]}>
      <View style={styles.resultHeader}>
        <Text style={styles.resultIcon}>{statusIcon(item.status)}</Text>
        <View style={styles.resultMeta}>
          <Text style={styles.resultType}>{item.recordType}</Text>
          <Text style={styles.resultPet}>{item.petName ?? item.petId}</Text>
        </View>
        <View style={[styles.statusPill, statusPillStyle(item.status)]}>
          <Text style={styles.statusPillText}>{item.status.replace('_', ' ').toUpperCase()}</Text>
        </View>
      </View>

      <Text style={styles.resultDate}>Visit: {new Date(item.visitDate).toLocaleDateString()}</Text>

      {item.reason ? <Text style={styles.resultReason}>{item.reason}</Text> : null}

      <View style={styles.hashRow}>
        <Text style={styles.hashLabel}>Local hash:</Text>
        <Text style={styles.hashValue}>{item.localHash.slice(0, 16)}…</Text>
      </View>

      {item.onChainHash ? (
        <View style={styles.hashRow}>
          <Text style={styles.hashLabel}>On-chain:</Text>
          <Text style={[styles.hashValue, !item.hashMatch && styles.hashMismatch]}>
            {item.onChainHash.slice(0, 16)}…
          </Text>
        </View>
      ) : null}

      {item.reAnchored && (
        <View style={styles.reAnchorBadge}>
          <Text style={styles.reAnchorText}>
            🔗 Re-anchored{item.reAnchorTxHash ? ` · TX: ${item.reAnchorTxHash.slice(0, 12)}…` : ''}
          </Text>
        </View>
      )}
    </View>
  );

  const renderDiffCard = (item: RecordReconciliationResult) => {
    const decision = decisions[item.recordId];
    return (
      <View key={item.recordId} style={styles.diffCard}>
        <View style={styles.resultHeader}>
          <Text style={styles.resultIcon}>🚨</Text>
          <View style={styles.resultMeta}>
            <Text style={styles.resultType}>{item.recordType}</Text>
            <Text style={styles.resultPet}>{item.petName ?? item.petId}</Text>
          </View>
        </View>
        <Text style={styles.resultDate}>Visit: {new Date(item.visitDate).toLocaleDateString()}</Text>
        {item.reason ? <Text style={styles.resultReason}>{item.reason}</Text> : null}

        <View style={styles.diffRow}>
          <View style={[styles.diffCol, styles.diffColLocal]}>
            <Text style={styles.diffColLabel}>Local</Text>
            <Text style={[styles.diffColValue, styles.diffValueChangedLocal]}>
              {item.localHash.slice(0, 16)}…
            </Text>
          </View>
          <View style={[styles.diffCol, styles.diffColChain]}>
            <Text style={styles.diffColLabel}>On-chain</Text>
            <Text style={[styles.diffColValue, styles.diffValueChangedChain]}>
              {item.onChainHash ? `${item.onChainHash.slice(0, 16)}…` : '— none —'}
            </Text>
          </View>
        </View>

        {decision ? (
          <View style={styles.decisionBadge}>
            <Text style={styles.decisionBadgeText}>
              ✓ Resolved — trusted {decision === 'local' ? 'local record' : 'blockchain'}
            </Text>
          </View>
        ) : (
          <View style={styles.diffActions}>
            <TouchableOpacity
              style={styles.trustLocalBtn}
              onPress={() => handleTrustLocal(item)}
              accessibilityRole="button"
              accessibilityLabel="Trust local record"
            >
              <Text style={styles.trustLocalBtnText}>Trust Local</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.trustChainBtn}
              onPress={() => handleTrustBlockchain(item)}
              accessibilityRole="button"
              accessibilityLabel="Trust blockchain record"
            >
              <Text style={styles.trustChainBtnText}>Trust Blockchain</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderReportCard = ({ item }: { item: ReconciliationReport }) => (
    <TouchableOpacity
      style={styles.reportCard}
      onPress={() => {
        setSelectedReport(item);
        setView('report');
      }}
      accessibilityRole="button"
      accessibilityLabel={`Report from ${new Date(item.startedAt).toLocaleDateString()}`}
    >
      <View style={styles.reportCardRow}>
        <Text style={styles.reportCardDate}>{new Date(item.startedAt).toLocaleString()}</Text>
        {item.tamperedCount > 0 && (
          <View style={styles.alertBadge}>
            <Text style={styles.alertBadgeText}>⚠️ {item.tamperedCount} tampered</Text>
          </View>
        )}
      </View>
      <Text style={styles.reportCardStats}>
        {item.totalRecords} records · {item.cleanCount} clean · {item.tamperedCount} tampered ·{' '}
        {item.missingChainCount} unanchored
      </Text>
      {item.reAnchoredCount > 0 && (
        <Text style={styles.reportCardReanchor}>🔗 {item.reAnchoredCount} re-anchored</Text>
      )}
    </TouchableOpacity>
  );

  // ── Report detail view ──────────────────────────────────────────────────────

  if (view === 'report' && selectedReport) {
    const tampered = selectedReport.results.filter((r) => r.status === 'tampered');
    const missing = selectedReport.results.filter((r) => r.status === 'missing_chain');
    const clean = selectedReport.results.filter((r) => r.status === 'clean');
    const errors = selectedReport.results.filter((r) => r.status === 'error');

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setView('dashboard')} accessibilityRole="button">
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Reconciliation Report</Text>
          <View style={{ width: 50 }} />
        </View>

        <ScrollView contentContainerStyle={styles.reportBody}>
          {/* Summary stats */}
          <View style={styles.statsGrid}>
            <StatCard label="Total" value={selectedReport.totalRecords} color="#374151" />
            <StatCard label="Clean" value={selectedReport.cleanCount} color="#16a34a" />
            <StatCard label="Tampered" value={selectedReport.tamperedCount} color="#dc2626" />
            <StatCard label="Unanchored" value={selectedReport.missingChainCount} color="#d97706" />
            <StatCard label="Errors" value={selectedReport.errorCount} color="#6b7280" />
            <StatCard label="Re-anchored" value={selectedReport.reAnchoredCount} color="#4f46e5" />
          </View>

          <Text style={styles.reportMeta}>
            Run: {new Date(selectedReport.startedAt).toLocaleString()}
            {'\n'}
            Duration:{' '}
            {Math.round(
              (new Date(selectedReport.completedAt).getTime() -
                new Date(selectedReport.startedAt).getTime()) /
                1000,
            )}
            s · Report ID: {selectedReport.id.slice(0, 8)}…
          </Text>

          {/* Tampered alert */}
          {tampered.length > 0 && (
            <View style={styles.tamperedAlert}>
              <Text style={styles.tamperedAlertTitle}>
                🚨 {tampered.length} Tampered Record{tampered.length > 1 ? 's' : ''} Detected
              </Text>
              <Text style={styles.tamperedAlertBody}>
                These records have been modified after blockchain anchoring. Admins have been
                alerted. Re-anchoring was attempted automatically.
              </Text>
            </View>
          )}

          {/* Results by section */}
          {tampered.length > 0 && (
            <>
              <View style={styles.tamperedSectionHeader}>
                <Text style={styles.sectionTitle}>⚠️ Tampered Records</Text>
                <TouchableOpacity
                  onPress={() => handleTrustBlockchainForAll(tampered)}
                  accessibilityRole="button"
                  accessibilityLabel="Trust blockchain for all tampered records"
                >
                  <Text style={styles.trustAllLink}>Trust blockchain for all</Text>
                </TouchableOpacity>
              </View>
              {tampered.map(renderDiffCard)}
            </>
          )}

          {missing.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>🔗 Unanchored Records</Text>
              {missing.map(renderResultRow)}
            </>
          )}

          {errors.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>❌ Errors</Text>
              {errors.map(renderResultRow)}
            </>
          )}

          {clean.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>✅ Clean Records ({clean.length})</Text>
              {clean.map(renderResultRow)}
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Dashboard view ──────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Record Reconciliation</Text>
        <View style={{ width: 50 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color="#10B981" />
      ) : (
        <ScrollView
          contentContainerStyle={styles.dashBody}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          {/* Status card */}
          <View style={styles.statusCard}>
            <Text style={styles.statusCardTitle}>Blockchain Integrity Check</Text>
            {summary?.isRunning ? (
              <View style={styles.runningRow}>
                <ActivityIndicator size="small" color="#4f46e5" />
                <Text style={styles.runningText}>Reconciliation in progress…</Text>
              </View>
            ) : (
              <Text style={styles.lastRunText}>
                {summary?.lastRunAt
                  ? `Last run: ${new Date(summary.lastRunAt).toLocaleString()}`
                  : 'No reconciliation run yet'}
              </Text>
            )}

            {summary?.lastReport && (
              <View style={styles.statsGrid}>
                <StatCard label="Total" value={summary.lastReport.totalRecords} color="#374151" />
                <StatCard label="Clean" value={summary.lastReport.cleanCount} color="#16a34a" />
                <StatCard
                  label="Tampered"
                  value={summary.lastReport.tamperedCount}
                  color="#dc2626"
                />
                <StatCard
                  label="Unanchored"
                  value={summary.lastReport.missingChainCount}
                  color="#d97706"
                />
              </View>
            )}

            <TouchableOpacity
              style={[styles.runBtn, (running || summary?.isRunning) && styles.btnDisabled]}
              onPress={handleRunNow}
              disabled={running || summary?.isRunning}
              accessibilityRole="button"
              accessibilityLabel="Run reconciliation now"
            >
              {running ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.runBtnText}>🔍 Run Reconciliation Now</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Past reports */}
          <Text style={styles.sectionTitle}>Past Reports</Text>
          {reports.length === 0 ? (
            <Text style={styles.emptyText}>
              No reports yet. Run a reconciliation to get started.
            </Text>
          ) : (
            <FlatList
              data={reports}
              keyExtractor={(r) => r.id}
              renderItem={renderReportCard}
              scrollEnabled={false}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatCard: React.FC<{ label: string; value: number; color: string }> = ({
  label,
  value,
  color,
}) => (
  <View style={styles.statCard}>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

// ─── Style helpers ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; border: string }> = {
  clean: { bg: '#f0fdf4', border: '#bbf7d0' },
  tampered: { bg: '#fef2f2', border: '#fecaca' },
  missing_chain: { bg: '#fffbeb', border: '#fde68a' },
  error: { bg: '#f9fafb', border: '#e5e7eb' },
};

const STATUS_PILL: Record<string, { bg: string; text: string }> = {
  clean: { bg: '#d1fae5', text: '#065f46' },
  tampered: { bg: '#fee2e2', text: '#991b1b' },
  missing_chain: { bg: '#fef3c7', text: '#92400e' },
  error: { bg: '#f3f4f6', text: '#374151' },
};

const statusRowStyle = (s: string) => {
  const c = STATUS_STYLES[s] ?? STATUS_STYLES.error;
  return { backgroundColor: c.bg, borderColor: c.border };
};

const statusPillStyle = (s: string) => {
  const c = STATUS_PILL[s] ?? STATUS_PILL.error;
  return { backgroundColor: c.bg };
};

const statusIcon = (s: string) =>
  ({ clean: '✅', tampered: '🚨', missing_chain: '🔗', error: '❌' })[s] ?? '❓';

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1f2937',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backText: { color: '#10b981', fontSize: 16, fontWeight: '600', minWidth: 50 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  loader: { marginTop: 40 },

  // Dashboard
  dashBody: { padding: 16 },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statusCardTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 8 },
  runningRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  runningText: { fontSize: 14, color: '#4f46e5', fontWeight: '600' },
  lastRunText: { fontSize: 13, color: '#6b7280', marginBottom: 12 },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 12,
  },
  statCard: {
    flex: 1,
    minWidth: 70,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, color: '#6b7280', marginTop: 2, fontWeight: '600' },

  runBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  runBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.6 },

  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 10,
    marginTop: 4,
  },
  emptyText: { fontSize: 14, color: '#9ca3af', textAlign: 'center', marginTop: 20 },

  // Report cards
  reportCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  reportCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  reportCardDate: { fontSize: 13, fontWeight: '600', color: '#111827' },
  reportCardStats: { fontSize: 12, color: '#6b7280' },
  reportCardReanchor: { fontSize: 12, color: '#4f46e5', marginTop: 2, fontWeight: '600' },
  alertBadge: {
    backgroundColor: '#fee2e2',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  alertBadgeText: { fontSize: 11, color: '#991b1b', fontWeight: '700' },

  // Report detail
  reportBody: { padding: 16 },
  reportMeta: { fontSize: 11, color: '#9ca3af', marginBottom: 16, lineHeight: 16 },

  tamperedAlert: {
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  tamperedAlertTitle: { fontSize: 15, fontWeight: '700', color: '#991b1b', marginBottom: 6 },
  tamperedAlertBody: { fontSize: 13, color: '#7f1d1d', lineHeight: 18 },

  // Result rows
  resultRow: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  resultIcon: { fontSize: 18 },
  resultMeta: { flex: 1 },
  resultType: { fontSize: 14, fontWeight: '600', color: '#111827', textTransform: 'capitalize' },
  resultPet: { fontSize: 12, color: '#6b7280' },
  statusPill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText: { fontSize: 10, fontWeight: '700', color: '#374151' },
  resultDate: { fontSize: 12, color: '#6b7280', marginBottom: 4 },
  resultReason: { fontSize: 12, color: '#374151', marginBottom: 6, lineHeight: 16 },
  hashRow: { flexDirection: 'row', gap: 6, marginBottom: 2 },
  hashLabel: { fontSize: 11, color: '#9ca3af', fontWeight: '600', width: 70 },
  hashValue: { fontSize: 11, color: '#374151', fontFamily: 'monospace' },
  hashMismatch: { color: '#dc2626', fontWeight: '700' },
  reAnchorBadge: {
    marginTop: 6,
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    padding: 6,
  },
  reAnchorText: { fontSize: 11, color: '#1e40af', fontWeight: '600' },

  // Diff view (tampered records)
  tamperedSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  trustAllLink: { fontSize: 12, color: '#4f46e5', fontWeight: '700' },
  diffCard: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  diffRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  diffCol: { flex: 1, borderRadius: 8, padding: 8 },
  diffColLocal: { backgroundColor: '#fee2e2' },
  diffColChain: { backgroundColor: '#d1fae5' },
  diffColLabel: { fontSize: 11, fontWeight: '700', color: '#6b7280', marginBottom: 4 },
  diffColValue: { fontSize: 11, fontFamily: 'monospace' },
  diffValueChangedLocal: { color: '#991b1b', fontWeight: '700' },
  diffValueChangedChain: { color: '#065f46', fontWeight: '700' },
  diffActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  trustLocalBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dc2626',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  trustLocalBtnText: { color: '#dc2626', fontWeight: '700', fontSize: 13 },
  trustChainBtn: {
    flex: 1,
    backgroundColor: '#16a34a',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  trustChainBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  decisionBadge: {
    marginTop: 10,
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    padding: 8,
  },
  decisionBadgeText: { fontSize: 12, color: '#166534', fontWeight: '600' },
});

export default ReconciliationScreen;
