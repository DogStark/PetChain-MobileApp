/**
 * ExpenseExportScreen — Issue #1166
 *
 * Lets the owner request a date-filtered CSV of a pet's expense history.
 * Shows the server-confirmed permission, the export's generation status,
 * and when its download link expires. Nothing is cached on the device and
 * nothing is shared automatically: the link is opened only on explicit tap.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  ExpenseExportError,
  getExpenseExport,
  getExpenseExportPermission,
  isExpenseExportExpired,
  requestExpenseExport,
  validateExpenseDateRange,
  MAX_EXPORT_RANGE_DAYS,
  type ExpenseExport,
  type ExpenseExportErrorCode,
  type ExpenseExportStatus,
} from '../services/expenseExportService';

interface Props {
  petId: string;
  petName?: string;
  onBack: () => void;
}

type PermissionState = 'checking' | 'allowed' | 'denied' | 'error';

const STATUS_LABEL: Record<ExpenseExportStatus, string> = {
  queued: 'Queued',
  generating: 'Generating',
  ready: 'Ready',
  failed: 'Failed',
};

const ERROR_MESSAGE: Record<ExpenseExportErrorCode, string> = {
  PERMISSION_DENIED: 'You do not have permission to export this pet’s expenses.',
  INVALID_DATE: 'Enter dates as YYYY-MM-DD.',
  RANGE_REVERSED: 'The start date must be on or before the end date.',
  RANGE_TOO_LARGE: `Choose a range of ${MAX_EXPORT_RANGE_DAYS} days or fewer.`,
  NETWORK: 'You appear to be offline. Try again when you are connected.',
  FAILED: 'Something went wrong. Please try again.',
};

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function messageFor(err: unknown): string {
  return err instanceof ExpenseExportError ? ERROR_MESSAGE[err.code] : ERROR_MESSAGE.FAILED;
}

export default function ExpenseExportScreen({ petId, petName, onBack }: Props) {
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [exportItem, setExportItem] = useState<ExpenseExport | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPermission = useCallback(async () => {
    setPermission('checking');
    setError(null);
    try {
      const res = await getExpenseExportPermission(petId);
      setPermission(res.canExport ? 'allowed' : 'denied');
    } catch (err) {
      if (err instanceof ExpenseExportError && err.code === 'PERMISSION_DENIED') {
        setPermission('denied');
      } else {
        setPermission('error');
        setError(messageFor(err));
      }
    }
  }, [petId]);

  useEffect(() => {
    loadPermission();
  }, [loadPermission]);

  const handleRequest = useCallback(async () => {
    const rangeError = validateExpenseDateRange(from, to);
    if (rangeError) {
      setError(ERROR_MESSAGE[rangeError]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await requestExpenseExport({ petId, from, to });
      setExportItem(created);
      setCheckedAt(Date.now());
    } catch (err) {
      if (err instanceof ExpenseExportError && err.code === 'PERMISSION_DENIED') {
        setPermission('denied');
        setExportItem(null);
      }
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }, [from, to, petId]);

  const handleRefresh = useCallback(async () => {
    if (!exportItem) return;
    setBusy(true);
    setError(null);
    try {
      const latest = await getExpenseExport(petId, exportItem.id);
      setExportItem(latest);
      setCheckedAt(Date.now());
    } catch (err) {
      // Keep the last known status on screen; checkedAt shows how stale it is.
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }, [exportItem, petId]);

  const expired = exportItem ? isExpenseExportExpired(exportItem) : false;
  const canDownload = exportItem?.status === 'ready' && !!exportItem.downloadUrl && !expired;

  const handleDownload = useCallback(() => {
    if (canDownload && exportItem?.downloadUrl) {
      Linking.openURL(exportItem.downloadUrl);
    }
  }, [canDownload, exportItem]);

  const title = petName ? `Expense export — ${petName}` : 'Expense export';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.notice}>
        Exports contain private pet and cost records. Keep the file safe and delete it when you no
        longer need it.
      </Text>

      {permission === 'checking' && (
        <ActivityIndicator accessibilityLabel="Checking export permission" />
      )}

      {permission === 'denied' && (
        <Text style={styles.error} accessibilityRole="alert">
          {ERROR_MESSAGE.PERMISSION_DENIED}
        </Text>
      )}

      {permission === 'error' && (
        <TouchableOpacity
          style={styles.button}
          onPress={loadPermission}
          accessibilityRole="button"
          accessibilityLabel="Retry checking export permission"
        >
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      )}

      {permission === 'allowed' && (
        <>
          <Text style={styles.label}>Start date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={from}
            onChangeText={setFrom}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Start date"
            accessibilityHint="Format year-month-day"
          />

          <Text style={styles.label}>End date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={to}
            onChangeText={setTo}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="End date"
            accessibilityHint="Format year-month-day"
          />

          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={handleRequest}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Request expense export"
            accessibilityState={{ disabled: busy, busy }}
          >
            <Text style={styles.buttonText}>Request export</Text>
          </TouchableOpacity>
        </>
      )}

      {exportItem && (
        <View style={styles.card} accessibilityLiveRegion="polite">
          <Text style={styles.cardTitle}>
            {exportItem.from} to {exportItem.to}
          </Text>
          <Text style={styles.cardText}>
            Status:{' '}
            {expired && exportItem.status === 'ready'
              ? 'Expired'
              : STATUS_LABEL[exportItem.status]}
          </Text>
          {exportItem.expiresAt && (
            <Text style={styles.cardText}>
              Download expires: {new Date(exportItem.expiresAt).toLocaleString()}
            </Text>
          )}
          {checkedAt && (
            <Text style={styles.cardText}>
              Last checked: {new Date(checkedAt).toLocaleTimeString()}
            </Text>
          )}

          {exportItem.status !== 'ready' && exportItem.status !== 'failed' && (
            <TouchableOpacity
              style={[styles.button, busy && styles.buttonDisabled]}
              onPress={handleRefresh}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Check export status"
            >
              <Text style={styles.buttonText}>Check status</Text>
            </TouchableOpacity>
          )}

          {canDownload && (
            <TouchableOpacity
              style={styles.button}
              onPress={handleDownload}
              accessibilityRole="link"
              accessibilityLabel="Open expense CSV"
            >
              <Text style={styles.buttonText}>Open CSV</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {busy && <ActivityIndicator accessibilityLabel="Working" />}

      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Text style={styles.secondaryText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 8 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  notice: { fontSize: 13, color: '#4a5568', marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e0',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#3182ce',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondaryButton: { padding: 12, alignItems: 'center', marginTop: 16 },
  secondaryText: { color: '#3182ce', fontSize: 16 },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    gap: 4,
  },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardText: { fontSize: 14, color: '#2d3748' },
  error: { color: '#e53e3e', marginTop: 8 },
});
