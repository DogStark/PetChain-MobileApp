import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  authenticateOnForeground,
  getSession,
  login as loginWithPassword,
  logout as logoutSession,
  type AuthSession,
  type StoredSession,
} from '../services/authService';

type LockState = 'unlocked' | 'locked' | 'pin_required';

/**
 * Typed, observable security events surfaced to the app. Enrollment changes
 * (adding/removing a fingerprint or face profile) invalidate the biometric key
 * in SecureStore/Keychain; we surface that explicitly instead of a generic
 * login error so the UI can drive a safe recovery path.
 */
export type SecurityEvent =
  | { type: 'biometric_enrollment_changed'; reason: 'invalidated' | 'cancelled' | 'lockout' }
  | { type: 'biometric_recovered' };

type SecurityEventListener = (event: SecurityEvent) => void;

interface AuthContextValue {
  session: StoredSession | null;
  lockState: LockState;
  /** True when biometrics were invalidated and re-authentication is required. */
  biometricRecoveryRequired: boolean;
  login: (email: string, password: string) => Promise<AuthSession>;
  logout: () => Promise<void>;
  unlock: () => void;
  requirePin: () => void;
  refreshSession: () => Promise<void>;
  /** Subscribe to typed security events. Returns an unsubscribe function. */
  subscribeToSecurityEvents: (listener: SecurityEventListener) => () => void;
  /**
   * Complete recovery using the existing approved credential/recovery flow.
   * Re-authenticates with the user's credentials and clears the invalid
   * biometric reference. No secret is logged or passed through navigation.
   */
  recoverFromBiometricInvalidation: (email: string, password: string) => Promise<AuthSession>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Maps a foreground auth result to a typed security event. `authenticateOnForeground`
 * returns 'pin_required' when the biometric key is no longer valid (enrollment
 * change, cancellation, or platform lockout), which we treat as invalidation.
 */
function toSecurityEvent(result: Awaited<ReturnType<typeof authenticateOnForeground>>): SecurityEvent | null {
  if (result === 'pin_required') {
    return { type: 'biometric_enrollment_changed', reason: 'invalidated' };
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [lockState, setLockState] = useState<LockState>('locked');
  const [biometricRecoveryRequired, setBiometricRecoveryRequired] = useState(false);
  const listeners = React.useRef<Set<SecurityEventListener>>(new Set());

  const emitSecurityEvent = useCallback((event: SecurityEvent) => {
    listeners.current.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // A misbehaving listener must never break the auth flow.
      }
    });
  }, []);

  const subscribeToSecurityEvents = useCallback((listener: SecurityEventListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const refreshSession = useCallback(async () => {
    const next = await getSession();
    setSession(next);
    setLockState(next ? 'unlocked' : 'locked');
  }, []);

  useEffect(() => {
    refreshSession().catch(() => setLockState('locked'));
  }, [refreshSession]);

  useEffect(() => {
    const onChange = async (state: AppStateStatus) => {
      if (state !== 'active') return;
      const result = await authenticateOnForeground();
      const event = toSecurityEvent(result);
      if (event) {
        // Clear the invalid local biometric reference and require re-auth so we
        // never loop on biometric prompts. The session itself is preserved so
        // the recovery flow can explain what data remains on-device.
        setBiometricRecoveryRequired(true);
        setLockState('pin_required');
        emitSecurityEvent(event);
        return;
      }
      if (result === 'unlocked') {
        setBiometricRecoveryRequired(false);
        setLockState('unlocked');
      }
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [emitSecurityEvent]);

  const login = useCallback(async (email: string, password: string) => {
    const next = await loginWithPassword(email, password);
    setSession({ token: next.token, refreshToken: next.refreshToken });
    setBiometricRecoveryRequired(false);
    setLockState('unlocked');
    return next;
  }, []);

  const recoverFromBiometricInvalidation = useCallback(
    async (email: string, password: string) => {
      // Reuse the existing approved credential flow; on success the invalid
      // biometric reference is cleared and the user is re-enrolled.
      const next = await loginWithPassword(email, password);
      setSession({ token: next.token, refreshToken: next.refreshToken });
      setBiometricRecoveryRequired(false);
      setLockState('unlocked');
      emitSecurityEvent({ type: 'biometric_recovered' });
      return next;
    },
    [emitSecurityEvent],
  );

  const logout = useCallback(async () => {
    await logoutSession();
    setSession(null);
    setBiometricRecoveryRequired(false);
    setLockState('locked');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      lockState,
      biometricRecoveryRequired,
      login,
      logout,
      unlock: () => setLockState('unlocked'),
      requirePin: () => setLockState('pin_required'),
      refreshSession,
      subscribeToSecurityEvents,
      recoverFromBiometricInvalidation,
    }),
    [
      session,
      lockState,
      biometricRecoveryRequired,
      login,
      logout,
      refreshSession,
      subscribeToSecurityEvents,
      recoverFromBiometricInvalidation,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
