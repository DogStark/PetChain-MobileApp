import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAuth } from '../context/AuthContext';
import {
  getAccountDeletionStatus,
  type AccountDeletionState,
  type AccountDeletionStatus,
} from '../services/complianceService';
import { getUserProfile } from '../services/userService';

interface Props {
  onBack: () => void;
  /** Called after sign-out so the parent can redirect to the auth stack. */
  onSignedOut: () => void;
}

const STATE_COPY: Record<AccountDeletionState, { label: string; detail: string }> = {
  none: {
    label: 'No deletion request on file',
    detail: 'The server has no account deletion request for this account.',
  },
  requested: {
    label: 'Deletion requested',
    detail: 'Your request is queued. Your data has not been erased yet.',
  },
  processing: {
    label: 'Deletion in progress',
    detail: 'Removal is underway. Data is not erased all at once, so it can take time.',
  },
  completed: {
    label: 'Deletion completed',
    detail: 'The server reports that removal is finished. Retention rules are below.',
  },
  failed: {
    label: 'Deletion did not complete',
    detail: 'The last request failed. Contact PetChain support to resolve it.',
  },
  unknown: {
    label: 'Status unavailable',
    detail: 'The server returned a status this app does not recognise.',
  },
};

const formatDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
};

const AccountDeletionProgressScreen: React.FC<Props> = ({ onBack, onSignedOut }) => {
  const { logout } = useAuth();
  const [status, setStatus] = useState<AccountDeletionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await getUserProfile();
      if (!profile?.id) {
        throw new Error('No profile available');
      }
      setStatus(await getAccountDeletionStatus(profile.id));
      setFailed(false);
    } catch {
      // Keep the last server-confirmed status on screen, but flag it as possibly stale.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      // Local session is cleared even when the server call fails; proceed as Settings does.
    } finally {
      setSigningOut(false);
      onSignedOut();
    }
  }, [logout, onSignedOut]);

  const copy = status ? STATE_COPY[status.state] : null;
  const scheduledAt = formatDate(status?.deletionScheduledAt ?? null);
  const estimate = formatDate(status?.completionEstimate ?? null);

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
        <Text style={styles.title} accessibilityRole="header">
          Account Deletion
        </Text>
      </View>

      <View style={styles.content}>
        {loading && !status ? (
          <ActivityIndicator size="large" color="#4CAF50" accessibilityLabel="Loading status" />
        ) : (
          <View style={styles.card} accessibilityLiveRegion="polite">
            {copy ? (
              <>
                <Text style={styles.statusLabel}>{copy.label}</Text>
                <Text style={styles.body}>{copy.detail}</Text>
              </>
            ) : (
              <Text style={styles.body}>
                We could not load your deletion status. Check your connection and try again.
              </Text>
            )}
            {failed && status && (
              <Text style={styles.staleNotice}>
                We could not refresh this status. It may be out of date.
              </Text>
            )}
            {scheduledAt && <Text style={styles.meta}>Scheduled: {scheduledAt}</Text>}
            {estimate && <Text style={styles.meta}>Estimated completion: {estimate}</Text>}
          </View>
        )}

        {status?.retentionNotice && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>What we keep and why</Text>
            <Text style={styles.body}>{status.retentionNotice}</Text>
          </View>
        )}

        <Text style={styles.note}>
          Requesting deletion does not erase your data immediately. Signing out does not delete
          anything on the server.
        </Text>

        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary, loading && styles.btnDisabled]}
          onPress={() => void loadStatus()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Refresh deletion status"
        >
          {loading && status ? (
            <ActivityIndicator color="#2d3748" />
          ) : (
            <Text style={styles.btnSecondaryText}>Refresh Status</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, signingOut && styles.btnDisabled]}
          onPress={() => void handleSignOut()}
          disabled={signingOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          {signingOut ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnPrimaryText}>Sign Out</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 12,
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 17, color: '#4CAF50' },
  title: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  content: { padding: 16, gap: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    gap: 8,
  },
  statusLabel: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  body: { fontSize: 14, color: '#555', lineHeight: 20 },
  staleNotice: { fontSize: 13, color: '#b26a00', fontWeight: '600' },
  meta: { fontSize: 13, color: '#666' },
  note: { fontSize: 13, color: '#666', lineHeight: 18 },
  btn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#4CAF50' },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: { backgroundColor: '#edf2f7' },
  btnSecondaryText: { color: '#2d3748', fontWeight: '600', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
});

export default AccountDeletionProgressScreen;
