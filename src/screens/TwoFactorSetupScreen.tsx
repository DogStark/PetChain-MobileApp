import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Image,
  Share,
  AccessibilityInfo,
} from 'react-native';

import apiClient from '../../backend/services/apiClient';

type Step = 'idle' | 'setup' | 'confirm' | 'done';

interface SetupData {
  qrCode: string;
  secret: string;
}

export default function TwoFactorSetupScreen() {
  const [step, setStep] = useState<Step>('idle');
  const [loading, setLoading] = useState(false);
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [token, setToken] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState('');

  const announce = (msg: string) => AccessibilityInfo.announceForAccessibility(msg);

  const handleSetup = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.post('/auth/2fa/setup', {});
      setSetupData(res.data.data);
      setStep('setup');
      announce('QR code ready. Scan it with your authenticator app.');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Setup failed. Please try again.';
      setError(msg);
      announce(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleVerifySetup = useCallback(async () => {
    if (token.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.post('/auth/2fa/verify-setup', { token });
      setBackupCodes(res.data.data.backupCodes);
      setStep('done');
      announce('Two-factor authentication enabled. Save your backup codes.');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Verification failed. Check your code and try again.';
      setError(msg);
      announce(msg);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const handleCopyAll = useCallback(async () => {
    try {
      await Share.share({ message: backupCodes.join('\n') });
    } catch {
      Alert.alert('Error', 'Could not share backup codes.');
    }
  }, [backupCodes]);

  const handleDownload = useCallback(async () => {
    try {
      const content = [
        'PetChain - 2FA Backup Codes',
        'Generated: ' + new Date().toISOString(),
        'Keep these codes safe. Each code can only be used once.',
        '',
        ...backupCodes,
      ].join('\n');
      const uri = FileSystem.cacheDirectory + 'petchain-backup-codes.txt';
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/plain', UTI: 'public.plain-text' });
      } else {
        Alert.alert('Saved', 'Backup codes saved to cache. Sharing not available on this device.');
      }
    } catch {
      Alert.alert('Error', 'Could not download backup codes.');
    }
  }, [backupCodes]);

  const handleRegenerate = useCallback(() => {
    Alert.alert(
      'Regenerate Backup Codes',
      'This will invalidate all existing backup codes. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const res = await apiClient.post('/auth/2fa/backup-codes/regenerate', {});
              setBackupCodes(res.data.data.backupCodes);
              announce('New backup codes generated. Save them now.');
            } catch (e: unknown) {
              const msg =
                (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data
                  ?.error?.message ?? 'Failed to regenerate codes.';
              Alert.alert('Error', msg);
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Two-Factor Authentication
      </Text>

      {step === 'idle' && (
        <View>
          <Text style={styles.body}>
            Add an extra layer of security to your account. You'll need an authenticator app such as
            Google Authenticator or Authy.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={handleSetup}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Enable two-factor authentication"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Enable 2FA</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {step === 'setup' && setupData && (
        <View>
          <Text style={styles.body}>
            Scan this QR code with your authenticator app, then enter the 6-digit code below.
          </Text>
          <Image
            source={{ uri: setupData.qrCode }}
            style={styles.qr}
            accessibilityLabel="QR code for two-factor authentication setup"
          />
          <Text style={styles.secretLabel}>Can't scan? Enter this key manually:</Text>
          <Text
            style={styles.secret}
            selectable
            accessibilityLabel={`Manual entry key: ${setupData.secret}`}
          >
            {setupData.secret}
          </Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={(t) => {
              setToken(t.replace(/\D/g, '').slice(0, 6));
              setError('');
            }}
            placeholder="6-digit code"
            keyboardType="number-pad"
            maxLength={6}
            accessibilityLabel="Enter the 6-digit code from your authenticator app"
            autoFocus
          />
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <TouchableOpacity
            style={[styles.button, token.length !== 6 && styles.buttonDisabled]}
            onPress={handleVerifySetup}
            disabled={loading || token.length !== 6}
            accessibilityRole="button"
            accessibilityLabel="Confirm two-factor authentication setup"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Confirm</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {step === 'done' && (
        <View>
          <Text style={styles.success} accessibilityLiveRegion="assertive">
            ✓ Two-factor authentication is now enabled.
          </Text>
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              ⚠️ Save these codes — they won't be shown again. Each code is single-use.
            </Text>
          </View>
          <View style={styles.codesContainer} accessibilityLabel="Backup codes">
            <View style={styles.codesGrid}>
              {backupCodes.map((code) => (
                <Text key={code} style={styles.code} selectable>
                  {code}
                </Text>
              ))}
            </View>
          </View>
          <TouchableOpacity
            style={styles.button}
            onPress={() => void handleCopyAll()}
            accessibilityRole="button"
            accessibilityLabel="Copy all backup codes"
          >
            <Text style={styles.buttonText}>Copy All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.buttonSecondary}
            onPress={() => void handleDownload()}
            accessibilityRole="button"
            accessibilityLabel="Download backup codes as text file"
          >
            <Text style={styles.buttonSecondaryText}>Download as File</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.buttonDanger}
            onPress={handleRegenerate}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Regenerate backup codes, invalidates existing codes"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Regenerate Codes</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {step !== 'done' && error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <View style={styles.recoveryNote}>
        <Text style={styles.recoveryText}>
          Lost access? Use account recovery via your verified email address.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: '#1a1a1a' },
  body: { fontSize: 15, color: '#444', marginBottom: 20, lineHeight: 22 },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { backgroundColor: '#93c5fd' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonSecondaryText: { color: '#2563eb', fontWeight: '600', fontSize: 15 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 14,
    fontSize: 20,
    letterSpacing: 8,
    textAlign: 'center',
    marginBottom: 12,
  },
  qr: { width: 200, height: 200, alignSelf: 'center', marginBottom: 16 },
  secretLabel: { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  secret: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#374151',
    backgroundColor: '#f3f4f6',
    padding: 10,
    borderRadius: 6,
    marginBottom: 16,
  },
  error: { color: '#dc2626', fontSize: 14, marginBottom: 8 },
  success: { color: '#16a34a', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  codesContainer: { backgroundColor: '#f9fafb', borderRadius: 8, padding: 16, marginBottom: 16 },
  codesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  code: {
    fontFamily: 'monospace',
    fontSize: 15,
    color: '#111827',
    paddingVertical: 4,
    width: '45%',
  },
  recoveryNote: { marginTop: 32, padding: 12, backgroundColor: '#fef9c3', borderRadius: 8 },
  recoveryText: { fontSize: 13, color: '#713f12' },
  warningBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  warningText: { fontSize: 14, color: '#dc2626', fontWeight: '600', lineHeight: 20 },
  buttonDanger: {
    backgroundColor: '#dc2626',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
});
