import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import useOfflineSync from '../hooks/useOfflineSync';

/**
 * SyncBanner
 *
 * A compact, self-contained banner that surfaces the {@link useOfflineSync}
 * queue state to the user. Renders nothing when the device is online, every
 * mutation has been flushed, and there are no failures — so it can be safely
 * dropped into a layout without conditional rendering in the parent.
 *
 * Imperative `triggerSync` is exposed via the inline "Sync now" button.
 *
 * @example
 * ```tsx
 * <SyncBanner />
 * ```
 */
const SyncBanner: React.FC = () => {
  const { isOnline, pendingCount, isSyncing, lastSync, error, triggerSync } = useOfflineSync();

  const hasNothingToShow = isOnline && pendingCount === 0 && !isSyncing && error === null;

  if (hasNothingToShow) return null;

  const pluralize = (n: number): string => `change${n === 1 ? '' : 's'}`;

  let statusLine: string;
  if (isSyncing) {
    statusLine = '🔄 Syncing…';
  } else if (!isOnline) {
    statusLine =
      pendingCount > 0
        ? `📴 Offline · ${pendingCount} ${pluralize(pendingCount)} pending`
        : '📴 Offline';
  } else {
    statusLine = `⏳ ${pendingCount} ${pluralize(pendingCount)} pending sync`;
  }

  return (
    <View
      style={styles.container}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      testID="sync-banner"
    >
      <Text style={styles.statusText}>{statusLine}</Text>

      {error && (
        <Text style={styles.errorText} accessibilityLiveRegion="assertive">
          {error}
        </Text>
      )}

      {lastSync !== null && (
        <Text style={styles.lastSyncText}>
          Last synced: {new Date(lastSync).toLocaleTimeString()}
        </Text>
      )}

      <TouchableOpacity
        style={[styles.button, isSyncing && styles.buttonDisabled]}
        onPress={() => void triggerSync()}
        disabled={isSyncing}
        accessibilityRole="button"
        accessibilityLabel="Sync now"
        accessibilityState={{ disabled: isSyncing }}
        testID="sync-banner-button"
      >
        <Text style={styles.buttonText}>{isSyncing ? 'Syncing…' : 'Sync now'}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff3e0',
    borderRadius: 10,
    padding: 12,
    margin: 12,
    borderWidth: 1,
    borderColor: '#ed6c02',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  errorText: {
    fontSize: 13,
    color: '#d32f2f',
    marginTop: 6,
  },
  lastSyncText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  button: {
    marginTop: 10,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#a5d6a7',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default SyncBanner;
