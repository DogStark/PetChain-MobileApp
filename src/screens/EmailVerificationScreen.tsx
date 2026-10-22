import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { verifyEmail } from '../services/authService';

interface Props {
  onVerified: () => void;
  onSkip?: () => void;
}

const EmailVerificationScreen: React.FC<Props> = ({ onVerified, onSkip }) => {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleVerify = async () => {
    if (!token.trim()) {
      Alert.alert('Validation', 'Please enter the verification code.');
      return;
    }
    setLoading(true);
    try {
      await verifyEmail(token.trim());
      setDone(true);
    } catch (err: unknown) {
      Alert.alert('Verification Failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        {done ? (
          <>
            <Text style={styles.icon}>✅</Text>
            <Text style={styles.title}>Email Verified!</Text>
            <Text style={styles.subtitle}>Your account is now fully activated.</Text>
            <TouchableOpacity style={styles.btn} onPress={onVerified}>
              <Text style={styles.btnText}>Continue</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.icon}>📧</Text>
            <Text style={styles.title}>Verify Your Email</Text>
            <Text style={styles.subtitle}>
              Enter the verification code sent to your email address.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Verification Code"
              placeholderTextColor="#aaa"
              autoCapitalize="none"
              value={token}
              onChangeText={setToken}
            />

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={() => void handleVerify()}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Verify Email</Text>
              )}
            </TouchableOpacity>

            {onSkip && (
              <TouchableOpacity style={styles.skipBtn} onPress={onSkip}>
                <Text style={styles.skipText}>Skip for now</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  icon: { fontSize: 56, textAlign: 'center', marginBottom: 12 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 28, lineHeight: 20 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
    color: '#1a1a1a',
  },
  btn: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipText: { color: '#999', fontSize: 14 },
});

export default EmailVerificationScreen;
