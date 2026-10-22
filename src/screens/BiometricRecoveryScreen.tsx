import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { biometricService } from '../services/biometricService';
import { securityEventBus } from '../services/securityEventBus';
import type { BiometricEnrollmentChangeEvent } from '../services/securityEventBus';
import { useAuth } from '../hooks/useAuth';

/**
 * Recovery screen shown when the OS reports that the biometric enrollment
 * changed (fingerprint/face added or removed). The previously stored key is
 * invalid, so we clear the stale local reference and require the user to
 * re-authenticate through the existing approved credential/recovery flow.
 *
 * No secret material is ever logged or passed through navigation params.
 */
export const BiometricRecoveryScreen: React.FC = () => {
  const { reauthenticateWithCredentials } = useAuth();
  const [event, setEvent] = useState<BiometricEnrollmentChangeEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearedRef = useRef(false);

  // Observe the typed security event emitted by the biometric service.
  useEffect(() => {
    const unsubscribe = securityEventBus.subscribe('biometric.enrollmentChanged', (payload) => {
      setEvent(payload);
    });
    return unsubscribe;
  }, []);

  // Clear the invalid local biometric reference exactly once so the app never
  // loops on biometric prompts after an enrollment change.
  useEffect(() => {
    if (clearedRef.current) {
      return;
    }
    clearedRef.current = true;
    void biometricService.clearInvalidEnrollmentReference();
  }, []);

  const handleRecover = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Re-authentication uses the existing approved credential/recovery flow.
      await reauthenticateWithCredentials();
      await biometricService.clearInvalidEnrollmentReference();
      securityEventBus.emit('biometric.recoveryCompleted', {
        reason: event?.reason ?? 'enrollmentChanged',
      });
    } catch (err) {
      setError('Re-authentication failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [event, reauthenticateWithCredentials]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Biometric sign-in needs to be reset</Text>
        <Text style={styles.body}>
          Your device's biometric enrollment changed (a fingerprint or face profile was added or
          removed). For your security, the saved biometric key is no longer valid and has been
          cleared from this device.
        </Text>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>What stays on this device</Text>
          <Text style={styles.noticeBody}>
            Your account data and settings remain on this device. Only the invalid biometric key
            reference was removed. No passwords or secrets are stored in this screen or in
            navigation.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={handleRecover}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Re-authenticate to restore biometric sign-in"
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Re-authenticate</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          You can re-enable biometric sign-in from Settings after re-authenticating.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  content: { padding: 24 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 22, color: '#374151', marginBottom: 20 },
  notice: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  noticeTitle: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 6 },
  noticeBody: { fontSize: 13, lineHeight: 20, color: '#4b5563' },
  error: { color: '#b91c1c', fontSize: 14, marginBottom: 12 },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 13, color: '#6b7280', marginTop: 16, textAlign: 'center' },
});

export default BiometricRecoveryScreen;
