import React, { useState, useRef } from 'react';
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

import { login } from '../services/authService';
import type { AuthSession } from '../services/authService';
import { isValidEmail } from '../utils/validators';

interface Props {
  onSuccess: (session: AuthSession) => void;
  onRegister: () => void;
  onForgotPassword: () => void;
}

const LoginScreen: React.FC<Props> = ({ onSuccess, onRegister, onForgotPassword }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // ✅ proper ref fix
  const passwordRef = useRef<TextInput>(null);

  const handleLogin = async () => {
    // 🔴 Required fields
    if (!email.trim() || !password) {
      Alert.alert('Validation', 'Email and password are required.');
      return;
    }

    // 🔴 Email validation
    if (!isValidEmail(email)) {
      Alert.alert('Validation', 'Please enter a valid email address.');
      return;
    }

    setLoading(true);

    try {
      const session = await login(email.trim(), password);
      onSuccess(session);
    } catch (err: unknown) {
      Alert.alert('Login Failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="login-screen"
    >
      <View style={styles.inner}>
        <Text style={styles.logo}>🐾</Text>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in to PetMedTracka</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#aaa"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          testID="login-email-input"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#aaa"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          ref={passwordRef}
          returnKeyType="go"
          onSubmitEditing={() => void handleLogin()}
          testID="login-password-input"
        />

        <TouchableOpacity onPress={onForgotPassword} style={styles.forgotLink}>
          <Text style={styles.link}>Forgot password?</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={() => void handleLogin()}
          disabled={loading}
          testID="login-submit-button"
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <TouchableOpacity onPress={onRegister}>
            <Text style={styles.link}>Register</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

export default LoginScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },

  logo: { fontSize: 56, textAlign: 'center', marginBottom: 12 },

  title: {
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
    color: '#1a1a1a',
  },

  subtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },

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

  forgotLink: {
    alignSelf: 'flex-end',
    marginBottom: 20,
  },

  btn: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
  },

  btnDisabled: {
    opacity: 0.6,
  },

  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },

  footerText: {
    color: '#666',
    fontSize: 14,
  },

  link: {
    color: '#4CAF50',
    fontWeight: '600',
    fontSize: 14,
  },
});
