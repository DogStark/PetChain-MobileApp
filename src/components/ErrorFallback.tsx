import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';

import updateService from '../services/updateService';
import { encryptedAsyncStorage } from '../utils/encryptedAsyncStorage';

interface Props {
  onRetry: () => void;
  onContactSupport?: () => void;
  onRestart?: () => void;
  onClearCache?: () => void;
}

export default function ErrorFallback({
  onRetry,
  onContactSupport,
  onRestart,
  onClearCache,
}: Props) {
  const contactSupport = () => {
    if (onContactSupport) return onContactSupport();
    const mailto =
      'mailto:support@petchain.app?subject=App%20Error&body=I%20encountered%20an%20error.';
    void Linking.openURL(mailto).catch(() => {});
  };

  const restart = () => {
    if (onRestart) return onRestart();
    void updateService.applyOtaUpdate().catch(() => {});
  };

  const clearCache = async () => {
    if (onClearCache) return onClearCache();
    try {
      await encryptedAsyncStorage.clear();
    } catch {
      // ignore
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>
        An unexpected error occurred. Try retrying or contact support.
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.btn} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.btnText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.secondary]}
          onPress={contactSupport}
          accessibilityRole="button"
        >
          <Text style={[styles.btnText, styles.secondaryText]}>Contact Support</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.alt]}
          onPress={clearCache}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>Clear Cache</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.alt]}
          onPress={restart}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>Restart App</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8, color: '#1a1a1a' },
  message: { fontSize: 14, color: '#444', textAlign: 'center', marginBottom: 20 },
  actions: { flexDirection: 'row', gap: 12, marginVertical: 8 },
  btn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 8,
  },
  btnText: { color: '#fff', fontWeight: '600' },
  secondary: { backgroundColor: '#e0e0e0' },
  secondaryText: { color: '#333' },
  alt: { backgroundColor: '#1976D2' },
});
