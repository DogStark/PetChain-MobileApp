import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useWalletStore } from '../state/walletStore';
import { useNetworkStore } from '../state/networkStore';
import { usePermissions } from '../hooks/usePermissions';
import { getWalletHealth, WalletHealth } from '../services/walletHealthService';

export const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export function isHealthStale(lastVerifiedAt: number | null, now: number = Date.now()): boolean {
  if (lastVerifiedAt == null) {
    return true;
  }
  return now - lastVerifiedAt > STALE_THRESHOLD_MS;
}

export default function WalletHealthScreen() {
  const { publicKey, connected } = useWalletStore();
  const { network } = useNetworkStore();
  const { canSign, permissionsConfirmed } = usePermissions();

  const [health, setHealth] = useState<WalletHealth | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    if (!connected || !publicKey) {
      setHealth(null);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const result = await getWalletHealth(publicKey, network);
      setHealth(result);
    } catch (e) {
      setError('Unable to verify wallet health. Showing last known state.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [connected, publicKey, network]);

  useEffect(() => {
    setLoading(true);
    loadHealth();
  }, [loadHealth]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadHealth();
  }, [loadHealth]);

  const stale = useMemo(
    () => isHealthStale(health?.lastVerifiedAt ?? null),
    [health],
  );

  const identityMismatch =
    !!health && (health.account !== publicKey || health.network !== network);

  const signingBlocked = !permissionsConfirmed || !canSign || stale || identityMismatch;

  const blockReason = !permissionsConfirmed
    ? 'Permissions not confirmed by server.'
    : !canSign
    ? 'Signing permission denied.'
    : identityMismatch
    ? 'Account or network identity changed since last verification.'
    : stale
    ? 'Verification is stale. Refresh to re-verify.'
    : null;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Loading wallet health" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      accessibilityLabel="Wallet connection health and network"
    >
      <Text style={styles.title} accessibilityRole="header">
        Wallet Health
      </Text>

      {!connected || !publicKey ? (
        <View style={styles.card}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>No wallet connected</Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>Connected account</Text>
            <Text style={styles.value} selectable accessibilityLabel={`Connected account ${publicKey}`}>
              {publicKey}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Stellar network</Text>
            <Text style={styles.value}>{network}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Last verification</Text>
            <Text style={styles.value}>
              {health?.lastVerifiedAt
                ? new Date(health.lastVerifiedAt).toLocaleString()
                : 'Never verified'}
            </Text>
          </View>

          <View style={[styles.card, signingBlocked ? styles.cardWarning : styles.cardOk]}>
            <Text style={styles.label}>Signing</Text>
            <Text style={styles.value}>
              {signingBlocked ? 'Blocked' : 'Available'}
            </Text>
            {blockReason ? <Text style={styles.reason}>{blockReason}</Text> : null}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={styles.button}
            onPress={onRefresh}
            accessibilityRole="button"
            accessibilityLabel="Re-verify wallet connection"
          >
            <Text style={styles.buttonText}>Re-verify</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14' },
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  card: {
    backgroundColor: '#151B23',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#232B36',
  },
  cardOk: { borderColor: '#1F7A4D' },
  cardWarning: { borderColor: '#B45309' },
  label: { color: '#8A94A6', fontSize: 13, marginBottom: 4 },
  value: { color: '#FFFFFF', fontSize: 15 },
  reason: { color: '#F59E0B', fontSize: 13, marginTop: 8 },
  error: { color: '#F87171', fontSize: 13 },
  button: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
