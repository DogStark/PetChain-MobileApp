/**
 * SecuritySessionsScreen — lists the user's active sessions with device labels
 * and lets them revoke other sessions. The list only changes after the server
 * confirms a revocation; permissions come from the server, not the client.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import securitySessionService, {
  type SecuritySession,
  SecuritySessionError,
} from '../services/securitySessionService';
import { formatRelativeTime } from '../utils/dateLocale';
import { useSecureScreen } from '../utils/secureScreen';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const SecuritySessionsScreen: React.FC<Props> = ({ onBack }) => {
  useSecureScreen();

  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await securitySessionService.listSecuritySessions();
      setSessions(data);
      setLoadError(null);
      setPermissionDenied(false);
    } catch (error) {
      if (error instanceof SecuritySessionError && error.status === 403) {
        setSessions([]);
        setPermissionDenied(true);
        setLoadError(null);
      } else {
        // Keep any previously loaded rows visible, but flag them as possibly stale.
        setLoadError('Could not load sessions. Showing the last known list may be out of date.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const performRevoke = useCallback(
    async (session: SecuritySession) => {
      setRevokingId(session.id);
      try {
        await securitySessionService.revokeSecuritySession(session.id);
        // Server confirmed the revocation — now it is safe to drop the row.
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
      } catch (error) {
        if (error instanceof SecuritySessionError && error.status === 404) {
          // Already gone on the server — resync instead of guessing.
          Alert.alert('Session Ended', 'That session is no longer active.');
          void load(true);
        } else if (error instanceof SecuritySessionError && error.status === 403) {
          Alert.alert('Not Allowed', 'You do not have permission to revoke this session.');
          void load(true);
        } else {
          Alert.alert('Error', 'Failed to revoke the session. It is still active.');
        }
      } finally {
        setRevokingId(null);
      }
    },
    [load],
  );

  const handleRevoke = useCallback(
    (session: SecuritySession) => {
      Alert.alert(
        'Revoke Session',
        `Sign out "${session.deviceLabel}"? That device will need to log in again.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Revoke', style: 'destructive', onPress: () => void performRevoke(session) },
        ],
      );
    },
    [performRevoke],
  );

  const renderSession = (session: SecuritySession) => {
    const isProcessing = revokingId === session.id;

    return (
      <View key={session.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.deviceLabel} accessibilityRole="header">
            {session.deviceLabel}
          </Text>
          {session.isCurrent && (
            <View style={styles.currentBadge}>
              <Text style={styles.currentBadgeText}>This device</Text>
            </View>
          )}
        </View>
        <Text style={styles.meta}>Last active {formatRelativeTime(session.lastActiveAt)}</Text>

        {session.canRevoke && !session.isCurrent && (
          <TouchableOpacity
            style={[styles.revokeBtn, isProcessing && styles.btnDisabled]}
            onPress={() => handleRevoke(session)}
            disabled={isProcessing || revokingId !== null}
            accessibilityRole="button"
            accessibilityLabel={`Revoke session for ${session.deviceLabel}`}
            accessibilityHint="Signs out this device"
            accessibilityState={{ disabled: revokingId !== null, busy: isProcessing }}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#F44336" />
            ) : (
              <Text style={styles.revokeBtnText}>Revoke</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderBody = () => {
    if (loading) {
      return <ActivityIndicator size="large" color="#4CAF50" style={styles.loader} />;
    }

    if (permissionDenied) {
      return (
        <Text style={styles.muted} accessibilityRole="alert">
          You do not have permission to view security sessions.
        </Text>
      );
    }

    return (
      <>
        {loadError && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{loadError}</Text>
            <TouchableOpacity
              onPress={() => void load()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading sessions"
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {sessions.length === 0 && !loadError && (
          <Text style={styles.muted}>No active sessions.</Text>
        )}

        {sessions.map(renderSession)}
      </>
    );
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
        <Text style={styles.headerTitle} accessibilityRole="header">
          Active Sessions
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(true);
            }}
          />
        }
      >
        {renderBody()}
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
  headerSpacer: { width: 48 },
  content: { padding: 16 },
  loader: { marginTop: 32 },
  muted: { color: '#666', paddingVertical: 8 },
  errorBox: {
    backgroundColor: '#fdecea',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { color: '#b71c1c', marginBottom: 6 },
  retryText: { color: '#4CAF50', fontWeight: '700' },
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  deviceLabel: { fontWeight: '800', color: '#1a1a1a', flexShrink: 1 },
  currentBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  currentBadgeText: { color: '#4CAF50', fontWeight: '700', fontSize: 12 },
  meta: { color: '#666', marginBottom: 10 },
  revokeBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#F44336',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  revokeBtnText: { color: '#F44336', fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
});

export default SecuritySessionsScreen;
