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

interface AuthContextValue {
  session: StoredSession | null;
  lockState: LockState;
  login: (email: string, password: string) => Promise<AuthSession>;
  logout: () => Promise<void>;
  unlock: () => void;
  requirePin: () => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [lockState, setLockState] = useState<LockState>('locked');

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
      if (result === 'pin_required') setLockState('pin_required');
      if (result === 'unlocked') setLockState('unlocked');
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const next = await loginWithPassword(email, password);
    setSession({ token: next.token, refreshToken: next.refreshToken });
    setLockState('unlocked');
    return next;
  }, []);

  const logout = useCallback(async () => {
    await logoutSession();
    setSession(null);
    setLockState('locked');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      lockState,
      login,
      logout,
      unlock: () => setLockState('unlocked'),
      requirePin: () => setLockState('pin_required'),
      refreshSession,
    }),
    [session, lockState, login, logout, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
