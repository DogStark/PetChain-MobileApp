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

import { AuthError, requestPasswordReset, resetPassword } from '../services/authService';

interface Props {
  onBack: () => void;
}

/**
 * request → reset (pending: link requested, waiting on email)
 *        → done (completed)
 *        → expired (server rejected the link; request a new one)
 * The copy never confirms whether the email is registered; the server responds
 * the same way for known and unknown addresses.
 */
type Step = 'request' | 'reset' | 'expired' | 'done';

const ForgotPasswordScreen: React.FC<Props> = ({ onBack }) => {
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const clearSecrets = () => {
    setToken('');
    setNewPassword('');
    setConfirm('');
  };

  const handleRequest = async () => {
    if (!email.trim()) {
      Alert.alert('Validation', 'Please enter your email.');
      return;
    }
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      clearSecrets();
      setStep('reset');
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!token.trim() || !newPassword) {
      Alert.alert('Validation', 'Token and new password are required.');
      return;
    }
    if (newPassword !== confirm) {
      Alert.alert('Validation', 'Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Validation', 'Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token.trim(), newPassword);
      clearSecrets();
      setStep('done');
    } catch (err: unknown) {
      if (err instanceof AuthError && err.code === 'RESET_LINK_EXPIRED') {
        clearSecrets();
        setStep('expired');
        return;
      }
      Alert.alert('Error', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const startNewRequest = () => {
    clearSecrets();
    setStep('request');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        {/* Back */}
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>

        <Text style={styles.logo}>🔑</Text>

        {step === 'request' && (
          <>
            <Text style={styles.title} accessibilityRole="header">
              Forgot Password
            </Text>
            <Text style={styles.subtitle}>Enter your email and we'll send a reset link.</Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#aaa"
              accessibilityLabel="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={() => void handleRequest()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Send reset link"
              accessibilityState={{ disabled: loading, busy: loading }}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Send Reset Link</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {step === 'reset' && (
          <>
            <Text style={styles.title} accessibilityRole="header">
              Reset Password
            </Text>
            <Text style={styles.subtitle} accessibilityLiveRegion="polite">
              If an account exists for that email, a reset link is on its way. Check your inbox
              and spam folder, then enter the token from the link.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Reset Token"
              placeholderTextColor="#aaa"
              accessibilityLabel="Reset token"
              autoCapitalize="none"
              autoCorrect={false}
              value={token}
              onChangeText={setToken}
            />
            <TextInput
              style={styles.input}
              placeholder="New Password"
              placeholderTextColor="#aaa"
              accessibilityLabel="New password"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm New Password"
              placeholderTextColor="#aaa"
              accessibilityLabel="Confirm new password"
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
            />
            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={() => void handleReset()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Reset password"
              accessibilityState={{ disabled: loading, busy: loading }}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Reset Password</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => void handleRequest()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Send a new reset link"
              accessibilityState={{ disabled: loading }}
            >
              <Text style={styles.linkText}>Didn't get it? Send a new link</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'expired' && (
          <>
            <Text style={styles.successIcon}>⌛</Text>
            <Text style={styles.title} accessibilityRole="header">
              Link Expired
            </Text>
            <Text style={styles.subtitle} accessibilityLiveRegion="polite">
              This reset link has expired or was already used. Request a new one to continue.
            </Text>
            <TouchableOpacity
              style={styles.btn}
              onPress={startNewRequest}
              accessibilityRole="button"
              accessibilityLabel="Request a new reset link"
            >
              <Text style={styles.btnText}>Request New Link</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'done' && (
          <>
            <Text style={styles.successIcon}>✅</Text>
            <Text style={styles.title} accessibilityRole="header">
              Password Reset!
            </Text>
            <Text style={styles.subtitle} accessibilityLiveRegion="polite">
              You can now sign in with your new password.
            </Text>
            <TouchableOpacity
              style={styles.btn}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back to sign in"
            >
              <Text style={styles.btnText}>Back to Sign In</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  backBtn: { position: 'absolute', top: 48, left: 24 },
  backText: { fontSize: 17, color: '#4CAF50' },
  logo: { fontSize: 48, textAlign: 'center', marginBottom: 12 },
  successIcon: { fontSize: 56, textAlign: 'center', marginBottom: 12 },
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
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  linkBtn: { alignItems: 'center', marginTop: 16, paddingVertical: 8 },
  linkText: { color: '#4CAF50', fontSize: 15 },
});

export default ForgotPasswordScreen;
