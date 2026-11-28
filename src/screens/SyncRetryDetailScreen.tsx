/**
 * SyncRetryDetailScreen — Issue #1178
 *
 * Shows the last sync error, affected record, retry count and a safe manual
 * retry for changes that are still queued.
 *
 * Privacy by default: only queue metadata is rendered. Payload values (pet
 * names, notes, medical contents) are never read by this screen, and error
 * text is sanitised before display.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  loadSyncRetryDetails,
  retrySyncDetail,
  SYNC_ACTION_LABELS,
  SYNC_ENTITY_LABELS,
  type SyncRetryDetail,
} from '../services/syncRetryService';
import { formatRelativeTime } from '../utils/dateLocale';

export interface SyncRetryDetailScreenProps {
  /** Optional queue record to focus. Shows all failed records when omitted. */
  recordId?: string;
  onBack: () => void;
}

type ScreenStatus = 'loading' | 'ready' | 'empty' | 'error';

const PRIVACY_NOTICE =
  'Only sync details are shown here. Pet names, notes, and medical contents are never displayed.';
const OFFLINE_NOTICE =
  "You're offline. Retry is unavailable until you're back online; the change stays saved.";
const DENIED_NOTICE =
  'The server denied permission to retry synced changes. Ask the account owner for access.';

/** Accessibility announcements are best-effort, same as elsewhere in the app. */
function announce(message: string): void {
  const accessibility = AccessibilityInfo as unknown as
    | { announceForAccessibility?: (value: string) => void }
    | undefined;
  accessibility?.announceForAccessibility?.(message);
}

function formatQueuedAt(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 'recently' : formatRelativeTime(new Date(parsed));
}

const SyncRetryDetailScreen: React.FC<SyncRetryDetailScreenProps> = ({ recordId, onBack }) => {
  const [status, setStatus] = useState<ScreenStatus>('loading');
  const [details, setDetails] = useState<SyncRetryDetail[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [staleNotice, setStaleNotice] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setStatus('loading');

      try {
        const result = await loadSyncRetryDetails(recordId);
        setDetails(result.details);
        setIsOffline(result.isOffline);
        setStatus(result.details.length === 0 ? 'empty' : 'ready');
      } catch {
        setStatus('error');
      }
    },
    [recordId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const handleRetry = useCallback(
    async (detail: SyncRetryDetail) => {
      if (busyId || permissionDenied) return;

      setBusyId(detail.recordId);
      setNotice(null);

      try {
        const result = await retrySyncDetail(detail);

        if (result.outcome === 'completed') {
          announce('Change synced successfully.');
          await load('refresh');
        } else if (result.outcome === 'stale') {
          setStaleNotice(true);
          announce('This change was already synced or edited elsewhere. Details refreshed.');
          await load('refresh');
        } else if (result.outcome === 'offline') {
          setIsOffline(true);
          announce("You're offline. This change stays saved and will retry when you're connected.");
        } else if (result.outcome === 'permission-denied') {
          // Server-confirmed denial: stop offering the action and keep the
          // queued change rather than discarding local data.
          setPermissionDenied(true);
          announce(result.message);
          await load('refresh');
        } else {
          setNotice(result.message);
          announce(result.message);
          await load('refresh');
        }
      } catch {
        const message = 'Could not retry this change. It is still saved.';
        setNotice(message);
        announce(message);
      } finally {
        setBusyId(null);
      }
    },
    [busyId, load, permissionDenied],
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Text style={styles.backText}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title} accessibilityRole="header">
        Sync retry details
      </Text>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.card} testID="sync-retry-empty">
      <Text style={styles.emptyTitle} accessibilityRole="header">
        Nothing is waiting to sync
      </Text>
      <Text style={styles.message} accessibilityLiveRegion="polite">
        {recordId
          ? 'That change has already synced or is no longer queued.'
          : 'All of your saved changes have been sent to the server.'}
      </Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.card}>
      <Text style={styles.message} accessibilityRole="alert">
        Sync details could not be read from this device.
      </Text>
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => void load()}
        accessibilityRole="button"
        accessibilityLabel="Try loading sync retry details again"
      >
        <Text style={styles.primaryButtonText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );

  const renderDetail = (detail: SyncRetryDetail) => {
    const isBusy = busyId === detail.recordId;
    const retryDisabled = busyId !== null || isOffline || permissionDenied;
    const entityLabel = SYNC_ENTITY_LABELS[detail.entityType] ?? 'Record';
    const actionLabel = SYNC_ACTION_LABELS[detail.action] ?? detail.action;

    return (
      <View key={detail.recordId} style={styles.card} testID={`sync-retry-card-${detail.recordId}`}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} accessibilityRole="header">
            {entityLabel}
          </Text>
          <Text style={styles.badge}>{actionLabel}</Text>
        </View>

        <Text style={styles.label}>Affected record</Text>
        <Text
          style={styles.value}
          accessibilityLabel={`Affected record ${detail.recordReference}`}
        >
          {detail.recordReference}
        </Text>

        <Text style={styles.label}>Retries</Text>
        <Text style={[styles.value, detail.exhausted && styles.warningText]}>
          {detail.exhausted
            ? `${detail.retryCount} of ${detail.maxRetries} · automatic retries paused`
            : `${detail.retryCount} of ${detail.maxRetries}`}
        </Text>

        <Text style={styles.label}>Last sync error</Text>
        <Text
          style={[styles.errorText, !detail.hasErrorDetail && styles.mutedText]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {detail.lastError}
        </Text>

        <Text style={styles.meta}>Queued {formatQueuedAt(detail.queuedAt)}</Text>

        <TouchableOpacity
          style={[styles.primaryButton, retryDisabled && styles.buttonDisabled]}
          onPress={() => void handleRetry(detail)}
          disabled={retryDisabled}
          accessibilityRole="button"
          accessibilityLabel={`Retry sync for ${entityLabel} ${detail.recordReference}`}
          accessibilityHint="Sends only this queued change to the server"
          accessibilityState={{ disabled: retryDisabled, busy: isBusy }}
          testID={`sync-retry-button-${detail.recordId}`}
        >
          {isBusy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Retry now</Text>
          )}
        </TouchableOpacity>
        {isOffline && !permissionDenied ? (
          <Text style={styles.helperText}>Connect to the internet to retry.</Text>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {renderHeader()}

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.privacyNotice}>{PRIVACY_NOTICE}</Text>

        {permissionDenied ? (
          <Text style={styles.deniedNotice} accessibilityRole="alert">
            {DENIED_NOTICE}
          </Text>
        ) : null}

        {isOffline && status === 'ready' ? (
          <Text style={styles.offlineNotice} accessibilityLiveRegion="polite">
            {OFFLINE_NOTICE}
          </Text>
        ) : null}

        {staleNotice ? (
          <Text style={styles.staleNotice} accessibilityLiveRegion="polite">
            This change was updated elsewhere since you opened this screen. The details below
            were refreshed; review them before retrying.
          </Text>
        ) : null}

        {notice ? (
          <Text style={styles.notice} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}

        {status === 'loading' ? (
          <View style={styles.centered}>
            <ActivityIndicator
              size="large"
              color="#15803D"
              accessibilityLabel="Loading sync retry details"
            />
          </View>
        ) : status === 'error' ? (
          renderError()
        ) : status === 'empty' ? (
          renderEmpty()
        ) : (
          details.map(renderDetail)
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
  },
  backButton: { paddingVertical: 8, paddingRight: 12 },
  backText: { fontSize: 16, color: '#15803D', fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  privacyNotice: { fontSize: 13, color: '#374151', lineHeight: 18 },
  offlineNotice: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#92400E',
    borderRadius: 8,
    padding: 10,
    color: '#92400E',
    fontSize: 13,
  },
  deniedNotice: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#B91C1C',
    borderRadius: 8,
    padding: 10,
    color: '#B91C1C',
    fontSize: 13,
  },
  staleNotice: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#0369A1',
    borderRadius: 8,
    padding: 10,
    color: '#075985',
    fontSize: 13,
  },
  notice: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 10,
    color: '#111827',
    fontSize: 13,
  },
  centered: { paddingVertical: 48, alignItems: 'center' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  badge: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E3A8A',
    backgroundColor: '#DBEAFE',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', marginTop: 12 },
  value: { fontSize: 15, color: '#111827', marginTop: 2 },
  warningText: { color: '#92400E' },
  errorText: { fontSize: 14, color: '#B91C1C', marginTop: 2, lineHeight: 19 },
  mutedText: { color: '#4B5563' },
  meta: { fontSize: 12, color: '#4B5563', marginTop: 12 },
  primaryButton: {
    marginTop: 16,
    backgroundColor: '#15803D',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  helperText: { fontSize: 12, color: '#4B5563', marginTop: 8, textAlign: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 6 },
  message: { fontSize: 14, color: '#111827', lineHeight: 20 },
});

export default SyncRetryDetailScreen;
