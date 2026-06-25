import * as SecureStore from 'expo-secure-store';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

import config from '../config';
import { authenticateWithBiometric, verifyPin } from '../services/authService';

interface LockScreenProps {
  onUnlock: () => void;
  onWipe: () => void;
  showPinFallback?: boolean;
}

const ATTEMPTS_KEY = 'lock_attempts_v1';
const COOLDOWN_UNTIL_KEY = 'lock_cooldown_until_v1';

const { warnAfterAttempts, cooldownAfterAttempts, cooldownSeconds, wipeAfterAttempts } =
  config.pinLock;

async function loadAttempts(): Promise<number> {
  try {
    const v = await SecureStore.getItemAsync(ATTEMPTS_KEY);
    return v ? parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
}

async function saveAttempts(n: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(ATTEMPTS_KEY, String(n));
  } catch {
    // ignore
  }
}

async function loadCooldownUntil(): Promise<number> {
  try {
    const v = await SecureStore.getItemAsync(COOLDOWN_UNTIL_KEY);
    return v ? parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
}

async function saveCooldownUntil(ts: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(COOLDOWN_UNTIL_KEY, String(ts));
  } catch {
    // ignore
  }
}

async function clearLockState(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(ATTEMPTS_KEY);
    await SecureStore.deleteItemAsync(COOLDOWN_UNTIL_KEY);
  } catch {
    // ignore
  }
}

export default function LockScreen({ onUnlock, onWipe, showPinFallback = false }: LockScreenProps) {
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<'biometric' | 'pin'>(showPinFallback ? 'pin' : 'biometric');
  const [loading, setLoading] = useState(false);

  const [attempts, setAttempts] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load persisted state on mount
  useEffect(() => {
    void (async () => {
      const [savedAttempts, savedCooldown] = await Promise.all([
        loadAttempts(),
        loadCooldownUntil(),
      ]);
      setAttempts(savedAttempts);
      const remaining = Math.ceil((savedCooldown - Date.now()) / 1000);
      if (remaining > 0) startCooldownTimer(remaining);
    })();
  }, []);

  function startCooldownTimer(seconds: number) {
    setCooldownRemaining(seconds);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldownRemaining((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleBiometric = useCallback(async () => {
    setLoading(true);
    try {
      const ok = await authenticateWithBiometric();
      if (ok) {
        await clearLockState();
        onUnlock();
      } else {
        setMode('pin');
      }
    } catch {
      setMode('pin');
    } finally {
      setLoading(false);
    }
  }, [onUnlock]);

  useEffect(() => {
    if (mode === 'biometric') void handleBiometric();
  }, [mode, handleBiometric]);

  const handlePinDigit = useCallback(
    async (digit: string) => {
      if (cooldownRemaining > 0) return;

      const next = pin + digit;
      setPin(next);
      if (next.length !== 6) return;

      setLoading(true);
      try {
        const ok = await verifyPin(next);
        if (ok) {
          await clearLockState();
          onUnlock();
          return;
        }

        // Wrong PIN — increment attempt counter
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        await saveAttempts(newAttempts);
        setPin('');

        if (newAttempts >= wipeAfterAttempts) {
          await clearLockState();
          onWipe();
          return;
        }

        if (newAttempts >= cooldownAfterAttempts) {
          const until = Date.now() + cooldownSeconds * 1000;
          await saveCooldownUntil(until);
          startCooldownTimer(cooldownSeconds);
        }
      } finally {
        setLoading(false);
      }
    },
    [pin, attempts, cooldownRemaining, onUnlock, onWipe],
  );

  const handleDelete = useCallback(() => setPin((p) => p.slice(0, -1)), []);

  const remaining = wipeAfterAttempts - attempts;
  const inCooldown = cooldownRemaining > 0;
  const keypadDisabled = loading || inCooldown;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔒 PetChain</Text>
      <Text style={styles.subtitle}>
        {mode === 'biometric' ? 'Authenticating…' : 'Enter your 6-digit PIN'}
      </Text>

      {mode === 'pin' && (
        <>
          <View style={styles.dotsRow}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
            ))}
          </View>

          {inCooldown && (
            <Text style={styles.warningText} accessibilityLiveRegion="polite">
              Too many attempts. Try again in {cooldownRemaining}s
            </Text>
          )}

          {!inCooldown && attempts >= warnAfterAttempts && attempts < wipeAfterAttempts && (
            <Text style={styles.warningText} accessibilityLiveRegion="polite">
              {remaining} attempt{remaining !== 1 ? 's' : ''} remaining before wipe
            </Text>
          )}

          {loading ? (
            <ActivityIndicator size="large" color="#4A90E2" style={styles.loader} />
          ) : (
            <View style={styles.numpad}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.key, (!key || keypadDisabled) && styles.keyEmpty]}
                  onPress={() => {
                    if (!key || keypadDisabled) return;
                    if (key === '⌫') handleDelete();
                    else void handlePinDigit(key);
                  }}
                  disabled={!key || keypadDisabled}
                  accessibilityLabel={key === '⌫' ? 'delete' : key || undefined}
                >
                  <Text style={[styles.keyText, keypadDisabled && styles.keyTextDisabled]}>
                    {key}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.biometricBtn}
            onPress={() => setMode('biometric')}
            accessibilityLabel="Use biometric authentication"
          >
            <Text style={styles.biometricText}>Use Face ID / Fingerprint</Text>
          </TouchableOpacity>
        </>
      )}

      {mode === 'biometric' && (
        <ActivityIndicator size="large" color="#4A90E2" style={styles.loader} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: { fontSize: 32, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#A0A0B0', marginBottom: 40 },
  dotsRow: { flexDirection: 'row', gap: 16, marginBottom: 24 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4A90E2',
    backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: '#4A90E2' },
  warningText: { color: '#FF6B6B', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  numpad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 240,
    gap: 16,
    justifyContent: 'center',
  },
  key: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2A2A4A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: { backgroundColor: 'transparent' },
  keyText: { fontSize: 22, color: '#FFFFFF', fontWeight: '500' },
  keyTextDisabled: { opacity: 0.3 },
  loader: { marginTop: 24 },
  biometricBtn: { marginTop: 32 },
  biometricText: { color: '#4A90E2', fontSize: 15 },
});
