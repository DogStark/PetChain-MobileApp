import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

const BiometricStep: React.FC<Props> = ({ onNext, onSkip }) => {
  const handleEnable = () => {
    // On a real device this would call expo-local-authentication
    if (Platform.OS !== 'web') {
      Alert.alert('Biometric', 'Biometric prompt would appear here on a real device.');
    }
    onNext();
  };

  return (
    <View style={styles.container} testID="biometric-step">
      <Text style={styles.emoji}>🔐</Text>
      <Text style={styles.title}>Secure Your Account</Text>
      <Text style={styles.subtitle}>
        Use Face ID, Touch ID, or your device PIN to keep your pet's data safe.
      </Text>

      <View style={styles.benefits}>
        {['Fast, one-tap login', 'AES-256 encrypted storage', 'No password to remember'].map(
          (b) => (
            <View key={b} style={styles.benefitRow}>
              <Text style={styles.check}>✓</Text>
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ),
        )}
      </View>

      <TouchableOpacity
        style={styles.primary}
        onPress={handleEnable}
        accessibilityRole="button"
        testID="biometric-enable-button"
      >
        <Text style={styles.primaryText}>Enable Biometric Login</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSkip} accessibilityRole="button" testID="biometric-skip-button">
        <Text style={styles.skip}>Use password instead</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emoji: { fontSize: 80, marginBottom: 20 },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  benefits: { width: '100%', marginBottom: 36 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  check: { fontSize: 16, color: '#10B981', marginRight: 10, fontWeight: 'bold' },
  benefitText: { fontSize: 15, color: '#374151' },
  primary: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  skip: { color: '#6B7280', fontSize: 15 },
});

export default BiometricStep;
