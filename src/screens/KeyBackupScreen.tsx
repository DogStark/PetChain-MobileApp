import { useNavigation, useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  AppState,
  type AppStateStatus,
  ActivityIndicator,
  AccessibilityInfo,
  Platform,
} from 'react-native';

import { requireBiometric } from '../services/authService';
import keyBackupService from '../services/keyBackupService';

type AuthState = 'auth_required' | 'authenticating' | 'authenticated' | 'generating' | 'hidden' | 'failed';

export default function KeyBackupScreen() {
  const [authState, setAuthState] = React.useState<AuthState>('auth_required');
  const [mnemonic, setMnemonic] = React.useState<string | null>(null);
  const [shares, setShares] = React.useState<string[] | null>(null);
  const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const nav = useNavigation();
  const appStateRef = useRef<AppStateStatus>('active');
  const lastInteractionRef = useRef<number>(Date.now());
  const idleTimeoutMs = 60000; // 1 minute
  const idleCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Platform-specific screenshot blocking
  React.useEffect(() => {
    if (Platform.OS === 'android') {
      // Set FLAG_SECURE on Android
      const { UIManager } = require('react-native');
      if (UIManager.setWindowSecureFlag) {
        UIManager.setWindowSecureFlag(true);
      }
    }
    return () => {
      if (Platform.OS === 'android') {
        const { UIManager } = require('react-native');
        if (UIManager.setWindowSecureFlag) {
          UIManager.setWindowSecureFlag(false);
        }
      }
    };
  }, []);

  // Track app state (foreground/background)
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  const handleAppStateChange = (state: AppStateStatus) => {
    appStateRef.current = state;
    if (state === 'background' || state === 'inactive') {
      // Hide material on background
      setAuthState('hidden');
      // Clear secrets from memory
      clearSecrets();
    } else if (state === 'active' && authState === 'hidden') {
      // On return to foreground, require re-auth
      setAuthState('auth_required');
    }
  };

  // Idle timeout check
  React.useEffect(() => {
    const checkIdle = () => {
      if (authState === 'authenticated' && appStateRef.current === 'active') {
        const elapsed = Date.now() - lastInteractionRef.current;
        if (elapsed >= idleTimeoutMs) {
          setAuthState('hidden');
          clearSecrets();
        }
      }
    };

    idleCheckIntervalRef.current = setInterval(checkIdle, 10000); // Check every 10s
    return () => {
      if (idleCheckIntervalRef.current) {
        clearInterval(idleCheckIntervalRef.current);
      }
    };
  }, [authState]);

  // Track user interaction for idle timeout
  const handleInteraction = useCallback(() => {
    lastInteractionRef.current = Date.now();
  }, []);

  // Clear sensitive data from memory
  const clearSecrets = useCallback(() => {
    setMnemonic(null);
    setShares(null);
    setCopiedIndex(null);
  }, []);

  // Request biometric re-authentication before generating/revealing material
  const handleRequestAuth = useCallback(async () => {
    setAuthState('authenticating');
    setError(null);

    try {
      const result = await requireBiometric();
      if (result === 'authenticated') {
        setAuthState('generating');
        generateMaterialSecurely();
      } else if (result === 'pin_fallback') {
        // PIN fallback would be handled by a modal in the UI
        setError('PIN authentication required');
        setAuthState('auth_required');
      } else {
        setError('Authentication failed. Please try again.');
        setAuthState('auth_required');
      }
    } catch (err) {
      setError('Authentication error. Please try again.');
      setAuthState('auth_required');
    }
  }, []);

  // Generate material only after successful re-auth
  const generateMaterialSecurely = useCallback(async () => {
    try {
      const m = await keyBackupService.generateMnemonic();
      setMnemonic(m);
      const parts = keyBackupService.createSocialShares(m, 5, 3);
      setShares(parts);
      setAuthState('authenticated');
      lastInteractionRef.current = Date.now();
    } catch (err) {
      setError('Failed to generate backup material. Please try again.');
      clearSecrets();
      setAuthState('auth_required');
    }
  }, []);

  // Clean up on unmount or if screen loses focus
  useFocusEffect(
    useCallback(() => {
      return () => {
        clearSecrets();
        setAuthState('hidden');
      };
    }, [clearSecrets]),
  );

  const handleContinue = useCallback(() => {
    clearSecrets();
    setAuthState('hidden');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (nav as any).navigate?.('Auth');
  }, [nav, clearSecrets]);

  // Render authentication required state
  if (authState === 'auth_required' || authState === 'hidden') {
    return (
      <ScrollView
        contentContainerStyle={styles.container}
        onTouchStart={handleInteraction}
        scrollEnabled={false}
      >
        <Text style={styles.title}>Secure Key Backup</Text>
        <Text style={styles.message}>
          This recovery material allows you to recover your account. Your device will verify your identity before revealing it.
        </Text>

        {authState === 'hidden' && (
          <Text
            style={[styles.message, styles.hiddenNotice]}
            accessibilityLabel="Recovery material is hidden for security"
          >
            Recovery material is hidden for security. Tap below to reveal it.
          </Text>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={styles.authBtn}
          onPress={handleRequestAuth}
          disabled={authState === 'authenticating'}
          accessibilityLabel="Authenticate to view recovery material"
          accessibilityHint="Requires biometric or PIN verification"
          onTouchStart={handleInteraction}
        >
          {authState === 'authenticating' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.authBtnText}>
              {authState === 'hidden' ? 'Re-authenticate to View' : 'Authenticate to Continue'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Render generating state
  if (authState === 'generating') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#1976D2" />
        <Text style={[styles.message, { marginTop: 16 }]}>Generating secure backup...</Text>
      </View>
    );
  }

  // Render authenticated state with material visible
  if (authState === 'authenticated' && mnemonic && shares) {
    return (
      <ScrollView
        contentContainerStyle={styles.container}
        onTouchStart={handleInteraction}
        scrollEventThrottle={16}
      >
        <Text
          style={styles.title}
          accessibilityLiveRegion="polite"
          accessibilityLabel="Secure Key Backup - Material Visible"
        >
          Secure Key Backup
        </Text>
        <Text style={styles.message}>
          Write down your mnemonic below. Keep it in a safe, offline location.
        </Text>

        <View
          style={styles.box}
          accessible={true}
          accessibilityLabel="Recovery mnemonic"
          accessibilityHint="This is sensitive information. Do not share."
        >
          <Text
            selectable
            style={styles.mnemonicText}
            onSelectionChange={handleInteraction}
          >
            {mnemonic}
          </Text>
        </View>

        <Text style={[styles.message, { marginTop: 16 }]}>
          Social recovery shares (give to trusted contacts)
        </Text>
        {shares.map((s, i) => (
          <View
            key={i}
            style={styles.shareRow}
            accessible={true}
            accessibilityLabel={`Recovery share ${i + 1}`}
            accessibilityHint="This share can be given to a trusted contact"
          >
            <Text
              selectable
              style={styles.shareText}
              onSelectionChange={handleInteraction}
            >
              {s}
            </Text>
          </View>
        ))}

        <TouchableOpacity
          style={styles.btn}
          onPress={handleContinue}
          accessibilityRole="button"
          accessibilityLabel="I have safely stored my recovery material"
          onTouchStart={handleInteraction}
        >
          <Text style={styles.btnText}>I've Saved My Backup</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Render failed state
  if (authState === 'failed') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Authentication Failed</Text>
        <Text style={styles.errorText}>{error || 'Could not verify your identity.'}</Text>
        <TouchableOpacity
          style={styles.authBtn}
          onPress={handleRequestAuth}
          accessibilityRole="button"
          accessibilityLabel="Try authenticating again"
        >
          <Text style={styles.authBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Default: authenticating or unknown state
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#fff', minHeight: '100%' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8, color: '#1a1a1a' },
  message: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 12 },
  hiddenNotice: { fontStyle: 'italic', color: '#d32f2f', marginTop: 16 },
  box: { marginTop: 12, padding: 16, borderRadius: 8, backgroundColor: '#f5f5f5' },
  mnemonicText: { fontSize: 14, color: '#111', lineHeight: 22, fontFamily: Platform.select({ ios: 'Courier', android: 'monospace' }) },
  shareRow: { marginTop: 8, padding: 12, backgroundColor: '#fafafa', borderRadius: 6 },
  shareText: { fontSize: 12, color: '#333', lineHeight: 18, fontFamily: Platform.select({ ios: 'Courier', android: 'monospace' }) },
  authBtn: {
    marginTop: 24,
    backgroundColor: '#1565c0',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: 50,
    justifyContent: 'center',
  },
  authBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btn: {
    marginTop: 24,
    backgroundColor: '#1976D2',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: 50,
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  errorText: { color: '#d32f2f', fontSize: 14, marginTop: 12, marginBottom: 12 },
});
