import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import {
  confirmShortcutDose,
  resolveDoseShortcut,
  type DoseShortcutTarget,
} from '../services/doseShortcutService';
import { useSecureScreen } from '../utils/secureScreen';

/**
 * Dose confirmation opened from the "log a dose" quick action (#1185).
 * Shows the pet and medicine the shortcut was bound to and only logs the dose
 * after the user presses the confirm button.
 */
interface Props {
  petId: string;
  medicationId: string;
  onClose: () => void;
}

type Status = 'loading' | 'ready' | 'unavailable' | 'submitting' | 'logged' | 'error';

const DoseConfirmationScreen: React.FC<Props> = ({ petId, medicationId, onClose }) => {
  useSecureScreen();

  const [status, setStatus] = useState<Status>('loading');
  const [target, setTarget] = useState<DoseShortcutTarget | null>(null);
  const [duplicate, setDuplicate] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const resolved = await resolveDoseShortcut(petId, medicationId);
      setTarget(resolved);
      setStatus(resolved ? 'ready' : 'unavailable');
    } catch {
      setStatus('error');
    }
  }, [petId, medicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConfirm = useCallback(async () => {
    if (!target) return;
    setStatus('submitting');
    try {
      const result = await confirmShortcutDose(target.medication);
      setDuplicate(result.duplicate);
      setStatus('logged');
    } catch {
      setStatus('error');
    }
  }, [target]);

  if (status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" accessibilityLabel="Loading dose" />
      </View>
    );
  }

  if (status === 'unavailable' || !target) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message} accessibilityRole="alert">
          This dose is no longer available. Check that the pet and medicine are still on your
          list.
        </Text>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={styles.secondaryButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'logged') {
    return (
      <View style={styles.centered}>
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {duplicate
            ? `${target.medication.name} was already logged for this dose.`
            : `${target.medication.name} logged for ${target.pet.name}.`}
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={styles.primaryButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const submitting = status === 'submitting';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading} accessibilityRole="header">
        Confirm dose
      </Text>
      <Text style={styles.detail}>Pet: {target.pet.name}</Text>
      <Text style={styles.detail}>Medicine: {target.medication.name}</Text>
      {target.medication.dosage ? (
        <Text style={styles.detail}>Dosage: {target.medication.dosage}</Text>
      ) : null}

      {status === 'error' ? (
        <Text style={styles.error} accessibilityRole="alert">
          We could not log this dose. Check your connection and try again.
        </Text>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryButton, submitting && styles.disabledButton]}
        onPress={status === 'error' ? load : handleConfirm}
        disabled={submitting}
        accessibilityRole="button"
        accessibilityLabel={status === 'error' ? 'Try again' : 'Confirm dose taken'}
        accessibilityState={{ disabled: submitting, busy: submitting }}
      >
        <Text style={styles.primaryButtonText}>
          {status === 'error' ? 'Try again' : 'Confirm dose taken'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={onClose}
        disabled={submitting}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
      >
        <Text style={styles.secondaryButtonText}>Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  detail: { fontSize: 16 },
  message: { fontSize: 16, textAlign: 'center' },
  error: { fontSize: 14, color: '#B00020' },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#2E7D32',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 8,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: '#2E7D32', fontSize: 16, fontWeight: '600' },
  disabledButton: { opacity: 0.6 },
});

export default DoseConfirmationScreen;
