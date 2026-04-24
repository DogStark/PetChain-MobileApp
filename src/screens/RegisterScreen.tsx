import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import AppText from '../components/AppText';
import { register } from '../services/authService';
import type { AuthSession } from '../services/authService';
import { scale, scaleFont } from '../utils/scaling';

interface Props {
  onSuccess: (session: AuthSession) => void;
  onLogin: () => void;
}

const RegisterScreen: React.FC<Props> = ({ onSuccess, onLogin }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password) {
      Alert.alert('Validation', 'All fields are required.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Validation', 'Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Validation', 'Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const session = await register({ name: name.trim(), email: email.trim(), password });
      onSuccess(session);
    } catch (err: unknown) {
      Alert.alert('Registration Failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <AppText style={styles.logo}>🐾</AppText>
        <AppText style={styles.title}>Create Account</AppText>
        <AppText style={styles.subtitle}>Join PetMedTracka</AppText>

        <TextInput
          style={styles.input}
          placeholder="Full Name"
          placeholderTextColor="#aaa"
          value={name}
          onChangeText={setName}
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          blurOnSubmit={false}
        />
        <TextInput
          ref={emailRef}
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#aaa"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
        />
        <TextInput
          ref={passwordRef}
          style={styles.input}
          placeholder="Password (min 8 characters)"
          placeholderTextColor="#aaa"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
          blurOnSubmit={false}
        />
        <TextInput
          ref={confirmRef}
          style={styles.input}
          placeholder="Confirm Password"
          placeholderTextColor="#aaa"
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
          returnKeyType="join"
          onSubmitEditing={() => void handleRegister()}
        />

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={() => void handleRegister()}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <AppText style={styles.btnText}>Create Account</AppText>
          )}
        </TouchableOpacity>

        <View style={styles.footer}>
          <AppText style={styles.footerText}>Already have an account? </AppText>
          <TouchableOpacity onPress={onLogin}>
            <AppText style={styles.link}>Sign In</AppText>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  inner: { flexGrow: 1, justifyContent: 'center', padding: scale(24) },
  logo: { fontSize: scale(56), textAlign: 'center', marginBottom: scale(12) },
  title: { fontSize: scaleFont(26), fontWeight: '700', textAlign: 'center', color: '#1a1a1a' },
  subtitle: {
    fontSize: scaleFont(15),
    color: '#666',
    textAlign: 'center',
    marginBottom: scale(32),
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: scale(10),
    paddingHorizontal: scale(14),
    paddingVertical: scale(12),
    fontSize: scaleFont(15),
    marginBottom: scale(12),
    color: '#1a1a1a',
  },
  btn: {
    backgroundColor: '#4CAF50',
    borderRadius: scale(10),
    paddingVertical: scale(14),
    alignItems: 'center',
    marginTop: scale(8),
    marginBottom: scale(20),
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: scaleFont(16), fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'center' },
  footerText: { color: '#666', fontSize: scaleFont(14) },
  link: { color: '#4CAF50', fontWeight: '600', fontSize: scaleFont(14) },
});

export default RegisterScreen;
