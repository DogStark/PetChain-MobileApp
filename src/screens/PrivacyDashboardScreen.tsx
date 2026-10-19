import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { resilientRequest } from '../services/apiClient';
import { requireBiometric } from '../services/authService';
import {
  buildDiagnosticPreview,
  buildSyncDiagnosticLog,
  exportDiagnosticsForSupport,
  type DiagnosticSnapshot,
  type DiagnosticSyncSummary,
} from '../services/diagnosticExport';
import errorTracking from '../services/errorTracking';
import {
  getLocalDatabaseRecoveryInfo,
  type LocalDatabaseRecoveryInfo,
} from '../services/localDB';
import { exportLocalAuditCsv, recordLocalAuditEvent } from '../services/localAuditService';
import { openSettingsSafely } from '../services/permissionService';
import { syncService } from '../services/syncService';
import { checkPermission, PermissionType, type PermissionStatus } from '../utils/permissions';

interface ConsentState {
  necessary: boolean;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
}

interface DataCategory {
  label: string;
  count: number | null;
}

type OsPermissionState = PermissionStatus | 'unknown';

const CATEGORIES: { key: keyof ConsentState; label: string; description: string }[] = [
  { key: 'necessary', label: 'Necessary', description: 'Required for the app to function.' },
  { key: 'functional', label: 'Functional', description: 'Remembers your preferences.' },
  { key: 'analytics', label: 'Analytics', description: 'Helps us improve the app.' },
  { key: 'marketing', label: 'Marketing', description: 'Personalised offers and updates.' },
];

const OS_PERMISSIONS: { type: PermissionType; label: string; impact: string }[] = [
  {
    type: PermissionType.LOCATION,
    label: 'Location',
    impact: 'Used to find nearby vet clinics. Only while you use the app.',
  },
  {
    type: PermissionType.CAMERA,
    label: 'Camera',
    impact: 'Used to scan pet QR codes and capture documents or photos.',
  },
  {
    type: PermissionType.NOTIFICATIONS,
    label: 'Notifications',
    impact: 'Used for medication, appointment and vaccination reminders.',
  },
];

const OS_STATUS_LABEL: Record<OsPermissionState, string> = {
  granted: 'Allowed',
  denied: 'Off',
  undetermined: 'Not asked yet',
  restricted: 'Restricted by this device',
  limited: 'Limited',
  unknown: 'Unavailable, check Settings',
};

interface Props {
  onDeleteAccount?: () => void;
}

/**
 * Builds the bundle contents shown in the consent preview. Sync state falls
 * back to "unavailable" rather than failing the whole export.
 */
async function collectDiagnosticSnapshot(): Promise<DiagnosticSnapshot> {
  let summary: DiagnosticSyncSummary | null = null;
  try {
    const status = await syncService.getStatus();
    summary = {
      isSyncing: status.isSyncing,
      lastSync: status.lastSync,
      pendingCount: status.pendingCount,
      failedCount: status.failedCount,
      conflictCount: status.conflicts.length,
    };
  } catch {
    // Leave summary null — recorded as unavailable.
  }

  const timestamp = new Date().toISOString();
  return {
    app: {
      version: Constants.expoConfig?.version ?? 'unknown',
      platform: Platform.OS,
    },
    logs: [
      {
        kind: 'crash',
        timestamp,
        message: 'Recent crash / error context',
        data: { source: 'errorTracking', level: 'error' },
      },
      buildSyncDiagnosticLog(summary, timestamp),
      {
        kind: 'wallet',
        timestamp,
        message: 'Recent wallet / payment events',
        data: { source: 'wallet', level: 'info' },
      },
      {
        kind: 'sos',
        timestamp,
        message: 'Recent SOS events',
        data: { source: 'sos', level: 'warning' },
      },
    ],
  };
}

const PrivacyDashboardScreen: React.FC<Props> = ({ onDeleteAccount }) => {
  const [consents, setConsents] = useState<ConsentState>({
    necessary: true,
    functional: false,
    analytics: false,
    marketing: false,
  });
  const [consentsConfirmed, setConsentsConfirmed] = useState(false);
  const [osPermissions, setOsPermissions] = useState<
    Partial<Record<PermissionType, OsPermissionState>>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingAudit, setExportingAudit] = useState(false);
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const [lastExportDate, setLastExportDate] = useState<string | null>(null);
  const [dataCategories, setDataCategories] = useState<DataCategory[]>([]);
  const [databaseRecovery, setDatabaseRecovery] = useState<LocalDatabaseRecoveryInfo | null>(null);

  const loadConsents = useCallback(async () => {
    setDatabaseRecovery(await getLocalDatabaseRecoveryInfo());
    try {
      const res = await resilientRequest<{
        data: {
          consents: ConsentState;
          lastExportDate?: string;
          dataCounts?: Record<string, number>;
        };
      }>({ method: 'GET', url: '/privacy/consent' });

      setConsents((prev) => ({ ...prev, ...res.data.data.consents }));
      setConsentsConfirmed(true);

      if (res.data.data.lastExportDate) {
        setLastExportDate(res.data.data.lastExportDate);
      }

      if (res.data.data.dataCounts) {
        const counts = res.data.data.dataCounts;
        setDataCategories([
          { label: 'Medical Records', count: counts.medicalRecords ?? null },
          { label: 'Medications', count: counts.medications ?? null },
          { label: 'Appointments', count: counts.appointments ?? null },
          { label: 'Pets', count: counts.pets ?? null },
        ]);
      }
    } catch {
      // Keep the last known choices visible, but never treat them as server-confirmed.
      setConsentsConfirmed(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOsPermissions = useCallback(async () => {
    const entries = await Promise.all(
      OS_PERMISSIONS.map(async ({ type }) => {
        try {
          return [type, await checkPermission(type)] as const;
        } catch {
          return [type, 'unknown'] as const;
        }
      }),
    );
    setOsPermissions(Object.fromEntries(entries));
  }, []);

  const handleRecoveryExport = useCallback(async (fileUri: string) => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Export unavailable', 'Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/vnd.sqlite3',
        dialogTitle: 'Export preserved PetChain database file',
      });
    } catch {
      Alert.alert('Error', 'Failed to export the preserved database file.');
    }
  }, []);

  useEffect(() => {
    void loadConsents();
  }, [loadConsents]);

  // Re-read OS permissions when returning from system Settings so the rows stay current.
  useEffect(() => {
    void loadOsPermissions();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadOsPermissions();
    });
    return () => subscription.remove();
  }, [loadOsPermissions]);

  const saveConsents = useCallback(async () => {
    if (!consentsConfirmed) return;
    setSaving(true);
    try {
      await resilientRequest({ method: 'POST', url: '/privacy/consent', data: { consents } });
      Alert.alert('Saved', 'Your privacy preferences have been updated.');
    } catch {
      Alert.alert('Error', 'Failed to save preferences.');
    } finally {
      setSaving(false);
    }
  }, [consents, consentsConfirmed]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await resilientRequest<object>({ method: 'GET', url: '/privacy/export' });

      const json = JSON.stringify(res.data, null, 2);
      const fileUri = `${FileSystem.cacheDirectory}petchain-data-export.json`;
      await FileSystem.writeAsStringAsync(fileUri, json, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: 'Save your PetChain data export',
        });
        const now = new Date().toISOString();
        setLastExportDate(now);
      } else {
        Alert.alert(
          'Export Ready',
          'Your data has been prepared but sharing is not available on this device.',
        );
      }
      await recordLocalAuditEvent({
        action: 'EXPORT',
        recordReference: 'account-data-export',
        result: 'success',
      });
    } catch {
      await recordLocalAuditEvent({
        action: 'EXPORT',
        recordReference: 'account-data-export',
        result: 'failure',
      }).catch(() => {});
      Alert.alert('Error', 'Failed to export data.');
    } finally {
      setExporting(false);
    }
  }, []);

  const handleAuditExport = useCallback(async () => {
    setExportingAudit(true);
    try {
      const csv = await exportLocalAuditCsv();
      const fileUri = `${FileSystem.cacheDirectory}petchain-local-audit.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing unavailable');
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: 'Export redacted local audit history',
      });
      await recordLocalAuditEvent({
        action: 'EXPORT',
        recordReference: 'local-audit-export',
        result: 'success',
      });
    } catch {
      await recordLocalAuditEvent({
        action: 'EXPORT',
        recordReference: 'local-audit-export',
        result: 'failure',
      }).catch(() => {});
      Alert.alert('Error', 'Failed to export local audit history.');
    } finally {
      setExportingAudit(false);
    }
  }, []);

  const runDiagnosticExport = useCallback(async (snapshot: DiagnosticSnapshot) => {
    setExportingDiagnostics(true);
    const confirmedAt = Date.now();
    try {
      const authResult = await requireBiometric();
      if (authResult === 'failed') {
        Alert.alert('Authentication required', 'Please authenticate to export diagnostics.');
        return;
      }
      const authenticatedAt = Date.now();
      await exportDiagnosticsForSupport({
        logs: snapshot.logs,
        app: snapshot.app,
        confirmation: { confirmed: true, confirmedAt },
        auth: {
          method: authResult === 'pin_fallback' ? 'passcode' : 'biometric',
          authenticatedAt,
        },
        share: async (uri) => {
          const canShare = await Sharing.isAvailableAsync();
          if (!canShare) {
            Alert.alert(
              'Export Ready',
              'Diagnostics were prepared but sharing is not available on this device.',
            );
            return false;
          }
          await Sharing.shareAsync(uri, {
            mimeType: 'application/json',
            dialogTitle: 'Share redacted diagnostics with support',
          });
          return true;
        },
      });
      errorTracking.captureMessage('diagnostic_export_completed', 'info', {
        redacted: true,
      });
    } catch {
      Alert.alert('Error', 'Failed to export diagnostics.');
    } finally {
      setExportingDiagnostics(false);
    }
  }, []);

  const handleDiagnosticExport = useCallback(() => {
    void (async () => {
      // Preview first: the same snapshot is previewed here and exported on confirm.
      const snapshot = await collectDiagnosticSnapshot();
      Alert.alert(
        'Export Diagnostics for Support',
        `This creates a short-lived, redacted diagnostic bundle for PetChain support. Tokens, pet IDs, health details, and precise locations are removed.\n\nIncluded:\n${buildDiagnosticPreview(snapshot)}\n\nContinue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm', onPress: () => void runDiagnosticExport(snapshot) },
        ],
      );
    })();
  }, [runDiagnosticExport]);

  const handleErase = useCallback(() => {
    if (onDeleteAccount) {
      onDeleteAccount();
    } else {
      Alert.alert(
        'Delete All Data',
        'This will permanently delete your account and all associated data. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await resilientRequest({ method: 'DELETE', url: '/privacy/erase' });
                Alert.alert('Done', 'Your data has been erased.');
              } catch {
                Alert.alert('Error', 'Failed to erase data.');
              }
            },
          },
        ],
      );
    }
  }, [onDeleteAccount]);

  if (loading) {
    return <ActivityIndicator style={styles.loader} size="large" color="#4299e1" />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Privacy Dashboard</Text>
      <Text style={styles.subtitle}>
        Manage how PetChain uses your data. Changes are logged for compliance.
      </Text>

      {dataCategories.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Your Data</Text>
          {dataCategories.map(({ label, count }) => (
            <View key={label} style={styles.row}>
              <Text style={styles.rowLabel}>{label}</Text>
              <Text style={styles.rowCount}>{count !== null ? count : '—'}</Text>
            </View>
          ))}
        </>
      )}

      <Text style={styles.sectionTitle}>Device Permissions</Text>
      {OS_PERMISSIONS.map(({ type, label, impact }) => {
        const status = osPermissions[type] ?? 'unknown';
        return (
          <View key={type} style={styles.row}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowLabel}>
                {label}: {OS_STATUS_LABEL[status]}
              </Text>
              <Text style={styles.rowDesc}>{impact}</Text>
            </View>
            <TouchableOpacity
              onPress={() => void openSettingsSafely()}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={`Change ${label} permission`}
              accessibilityHint="Opens system Settings"
            >
              <Text style={styles.linkText}>Change</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>Data Processing Consents</Text>
      {!consentsConfirmed && (
        <View style={styles.staleNotice} accessibilityRole="alert">
          <Text style={styles.rowDesc}>
            Couldn&apos;t confirm your saved choices with the server. Showing your last known
            choices. Saving is paused until they load.
          </Text>
          <TouchableOpacity
            onPress={() => void loadConsents()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading privacy preferences"
          >
            <Text style={styles.linkText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {CATEGORIES.map(({ key, label, description }) => (
        <View key={key} style={styles.row}>
          <View style={styles.rowInfo}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowDesc}>{description}</Text>
          </View>
          <Switch
            value={consents[key]}
            onValueChange={(v) =>
              key !== 'necessary' && setConsents((prev) => ({ ...prev, [key]: v }))
            }
            disabled={key === 'necessary' || !consentsConfirmed}
            trackColor={{ true: '#4299e1', false: '#e2e8f0' }}
            accessibilityLabel={`Toggle ${label} consent`}
          />
        </View>
      ))}

      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary, !consentsConfirmed && styles.btnDisabled]}
        onPress={() => void saveConsents()}
        disabled={saving || !consentsConfirmed}
        accessibilityLabel="Save privacy preferences"
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Save Preferences</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Your Data Rights</Text>

      {databaseRecovery && (
        <View style={styles.recoverySection}>
          <Text style={styles.rowLabel}>Local database recovery</Text>
          <Text style={styles.rowDesc}>
            Support code: {databaseRecovery.supportCode}. Preserved files are available to export.
          </Text>
          {databaseRecovery.files.map((fileUri, index) => (
            <TouchableOpacity
              key={fileUri}
              style={[styles.btn, styles.btnSecondary]}
              onPress={() => void handleRecoveryExport(fileUri)}
              accessibilityLabel={`Export preserved database file ${index + 1}`}
            >
              <Text style={styles.btnTextSecondary}>
                Export preserved file {index + 1}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {lastExportDate && (
        <Text style={styles.lastExport}>
          Last exported: {new Date(lastExportDate).toLocaleDateString()}
        </Text>
      )}

      <TouchableOpacity
        style={[styles.btn, styles.btnSecondary]}
        onPress={() => void handleExport()}
        disabled={exporting}
        accessibilityLabel="Download my data"
      >
        {exporting ? (
          <ActivityIndicator color="#2d3748" />
        ) : (
          <Text style={styles.btnTextSecondary}>📥 Download My Data</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.btnSecondary]}
        onPress={() => void handleAuditExport()}
        disabled={exportingAudit}
        accessibilityLabel="Export redacted local audit history"
      >
        {exportingAudit ? (
          <ActivityIndicator color="#2d3748" />
        ) : (
          <Text style={styles.btnTextSecondary}>Export Local Audit History</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.btnSecondary]}
        onPress={handleDiagnosticExport}
        disabled={exportingDiagnostics}
        accessibilityLabel="Export diagnostics for support"
      >
        {exportingDiagnostics ? (
          <ActivityIndicator color="#2d3748" />
        ) : (
          <Text style={styles.btnTextSecondary}>Export Diagnostics for Support</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.btnDanger]}
        onPress={handleErase}
        accessibilityLabel="Delete my account"
      >
        <Text style={styles.btnText}>🗑 Delete My Account</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  loader: { flex: 1, marginTop: 40 },
  title: { fontSize: 22, fontWeight: '700', color: '#1a202c', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#718096', marginBottom: 20 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2d3748',
    marginTop: 24,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  rowInfo: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: '#1a202c', flex: 1 },
  rowCount: { fontSize: 14, color: '#718096' },
  rowDesc: { fontSize: 13, color: '#718096', marginTop: 2 },
  lastExport: { fontSize: 13, color: '#718096', marginBottom: 4, marginTop: 4 },
  recoverySection: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#edf2f7',
  },
  btn: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  btnPrimary: { backgroundColor: '#4299e1' },
  btnDisabled: { opacity: 0.5 },
  linkText: { color: '#4299e1', fontWeight: '600', fontSize: 14 },
  staleNotice: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  btnSecondary: { backgroundColor: '#edf2f7' },
  btnDanger: { backgroundColor: '#e53e3e' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  btnTextSecondary: { color: '#2d3748', fontWeight: '600', fontSize: 15 },
});

export default PrivacyDashboardScreen;
