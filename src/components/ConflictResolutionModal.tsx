/**
 * ConflictResolutionModal
 *
 * Shown when an offline write conflicts with a server-side change.
 * Displays a diff of "Your change" vs "Server version" and lets the user
 * choose which to keep (or keep-local for text fields acting as last-write-wins).
 *
 * Wire up by subscribing to offlineQueue.onConflict() or by checking
 * offlineQueue.getStatus().pendingConflicts on app foreground.
 */

import React, { useCallback } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import offlineQueue, { type ConflictItem, type ConflictResolution } from '../services/offlineQueue';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns keys that differ between two records */
function diffKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  conflict: ConflictItem | null;
  onDismiss: () => void;
}

const ConflictResolutionModal: React.FC<Props> = ({ conflict, onDismiss }) => {
  const handleResolve = useCallback(
    async (resolution: ConflictResolution) => {
      if (!conflict) return;
      await offlineQueue.resolveConflict(conflict.id, resolution);
      onDismiss();
    },
    [conflict, onDismiss],
  );

  if (!conflict) return null;

  const changedKeys = diffKeys(conflict.localData, conflict.serverData);

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            Sync Conflict
          </Text>
          <Text style={styles.subtitle}>
            Your offline change conflicts with a server update. Choose which version to keep.
          </Text>

          <ScrollView style={styles.diffContainer} showsVerticalScrollIndicator={false}>
            {/* Header row */}
            <View style={styles.diffRow}>
              <Text style={[styles.colHeader, styles.localHeader]}>Your change</Text>
              <Text style={[styles.colHeader, styles.serverHeader]}>Server version</Text>
            </View>

            {changedKeys.map((key) => (
              <View key={key} style={styles.diffRow}>
                <View style={[styles.cell, styles.localCell]}>
                  <Text style={styles.fieldLabel}>{key}</Text>
                  <Text style={styles.localValue} numberOfLines={3}>
                    {formatValue(conflict.localData[key])}
                  </Text>
                </View>
                <View style={[styles.cell, styles.serverCell]}>
                  <Text style={styles.fieldLabel}>{key}</Text>
                  <Text style={styles.serverValue} numberOfLines={3}>
                    {formatValue(conflict.serverData[key])}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.localButton]}
              onPress={() => handleResolve('keep-local')}
              accessibilityRole="button"
              accessibilityLabel="Keep your change"
              accessibilityHint="Overwrites the server version with your offline change"
            >
              <Text style={styles.buttonText}>Keep my change</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.serverButton]}
              onPress={() => handleResolve('keep-server')}
              accessibilityRole="button"
              accessibilityLabel="Keep server version"
              accessibilityHint="Discards your offline change and keeps the server version"
            >
              <Text style={styles.buttonText}>Keep server version</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  diffContainer: {
    maxHeight: 300,
    marginBottom: 16,
  },
  diffRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  colHeader: {
    flex: 1,
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 6,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  localHeader: {
    backgroundColor: '#fce4ec',
    color: '#b71c1c',
  },
  serverHeader: {
    backgroundColor: '#e8f5e9',
    color: '#1b5e20',
  },
  cell: {
    flex: 1,
    borderRadius: 6,
    padding: 8,
    marginHorizontal: 4,
  },
  localCell: { backgroundColor: '#fff3e0' },
  serverCell: { backgroundColor: '#f1f8e9' },
  fieldLabel: {
    fontSize: 11,
    color: '#888',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  localValue: { fontSize: 13, color: '#c62828' },
  serverValue: { fontSize: 13, color: '#2e7d32' },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  localButton: { backgroundColor: '#ef5350' },
  serverButton: { backgroundColor: '#43a047' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});

export default ConflictResolutionModal;
