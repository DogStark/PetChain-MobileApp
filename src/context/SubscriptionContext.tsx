import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';
import { useAuth } from './AuthContext';
import { api } from '../services/api';
import { storage } from '../services/storage';

export type EntitlementStatus =
  | 'unknown'
  | 'pending'
  | 'verifying'
  | 'verified'
  | 'expired'
  | 'revoked'
  | 'failed';

export interface Entitlement {
  status: EntitlementStatus;
  productId: string | null;
  expiresAt: string | null;
  lastVerifiedAt: string | null;
  error: string | null;
  retryCount: number;
}

interface SubscriptionContextValue {
  entitlement: Entitlement;
  isPremium: boolean;
  isPending: boolean;
  restore: () => Promise<void>;
  refresh: () => Promise<void>;
}

const INITIAL_ENTITLEMENT: Entitlement = {
  status: 'unknown',
  productId: null,
  expiresAt: null,
  lastVerifiedAt: null,
  error: null,
  retryCount: 0,
};

type Action =
  | { type: 'RESET' }
  | { type: 'PENDING'; productId: string | null }
  | { type: 'VERIFYING' }
  | { type: 'VERIFIED'; productId: string; expiresAt: string | null }
  | { type: 'EXPIRED'; productId: string | null }
  | { type: 'REVOKED'; productId: string | null }
  | { type: 'FAILED'; error: string };

function reducer(state: Entitlement, action: Action): Entitlement {
  switch (action.type) {
    case 'RESET':
      return INITIAL_ENTITLEMENT;
    case 'PENDING':
      return {
        ...state,
        status: 'pending',
        productId: action.productId,
        error: null,
      };
    case 'VERIFYING':
      return { ...state, status: 'verifying', error: null };
    case 'VERIFIED':
      return {
        ...state,
        status: 'verified',
        productId: action.productId,
        expiresAt: action.expiresAt,
        lastVerifiedAt: new Date().toISOString(),
        error: null,
        retryCount: 0,
      };
    case 'EXPIRED':
      return {
        ...state,
        status: 'expired',
        productId: action.productId,
        expiresAt: null,
        lastVerifiedAt: new Date().toISOString(),
        error: null,
      };
    case 'REVOKED':
      return {
        ...state,
        status: 'revoked',
        productId: action.productId,
        expiresAt: null,
        lastVerifiedAt: new Date().toISOString(),
        error: null,
      };
    case 'FAILED':
      return {
        ...state,
        status: 'failed',
        error: action.error,
        retryCount: state.retryCount + 1,
      };
    default:
      return state;
  }
}

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(
  undefined,
);

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1000;

function backoffDelay(retryCount: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, retryCount);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const [entitlement, dispatch] = useReducer(reducer, INITIAL_ENTITLEMENT);
  const userIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  // Reset entitlement whenever the account changes so a receipt can never be
  // attached to the wrong user.
  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (userIdRef.current !== nextUserId) {
      userIdRef.current = nextUserId;
      dispatch({ type: 'RESET' });
    }
  }, [user?.id]);

  const verifyReceipt = useCallback(
    async (receipt: string, productId: string, userId: string) => {
      // Server-side verification is the single source of truth. Local premium
      // flags are never trusted on their own.
      const result = await api.post('/subscriptions/verify', {
        receipt,
        productId,
        platform: Platform.OS,
        userId,
      });
      return result as {
        status: 'verified' | 'expired' | 'revoked';
        productId: string;
        expiresAt: string | null;
      };
    },
    [],
  );

  const reconcile = useCallback(
    async (receipt: string, productId: string) => {
      const userId = userIdRef.current;
      if (!userId) {
        dispatch({ type: 'FAILED', error: 'Not signed in' });
        return;
      }
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      dispatch({ type: 'VERIFYING' });

      let attempt = 0;
      // Retry with exponential backoff for transient verification failures.
      while (attempt <= MAX_RETRIES) {
        try {
          const result = await verifyReceipt(receipt, productId, userId);
          // Guard against account switching mid-flight.
          if (userIdRef.current !== userId) {
            inFlightRef.current = false;
            return;
          }
          if (result.status === 'verified') {
            dispatch({
              type: 'VERIFIED',
              productId: result.productId,
              expiresAt: result.expiresAt,
            });
          } else if (result.status === 'expired') {
            dispatch({ type: 'EXPIRED', productId: result.productId });
          } else {
            dispatch({ type: 'REVOKED', productId: result.productId });
          }
          inFlightRef.current = false;
          return;
        } catch (err) {
          attempt += 1;
          if (attempt > MAX_RETRIES) {
            dispatch({
              type: 'FAILED',
              error: err instanceof Error ? err.message : 'Verification failed',
            });
            inFlightRef.current = false;
            return;
          }
          await sleep(backoffDelay(attempt));
        }
      }
      inFlightRef.current = false;
    },
    [verifyReceipt],
  );

  const restore = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) {
      dispatch({ type: 'FAILED', error: 'Not signed in' });
      return;
    }
    try {
      // Idempotent: repeated restores simply re-run reconciliation.
      const purchases = await RNIap.getAvailablePurchases();
      const active = purchases.find((p) => p.productId);
      if (!active || !active.transactionReceipt) {
        dispatch({ type: 'REVOKED', productId: null });
        return;
      }
      dispatch({ type: 'PENDING', productId: active.productId });
      await reconcile(active.transactionReceipt, active.productId);
    } catch (err) {
      dispatch({
        type: 'FAILED',
        error: err instanceof Error ? err.message : 'Restore failed',
      });
    }
  }, [reconcile]);

  const refresh = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) {
      return;
    }
    try {
      const result = (await api.get('/subscriptions/entitlement')) as {
        status: 'verified' | 'expired' | 'revoked';
        productId: string;
        expiresAt: string | null;
      };
      if (userIdRef.current !== userId) {
        return;
      }
      if (result.status === 'verified') {
        dispatch({
          type: 'VERIFIED',
          productId: result.productId,
          expiresAt: result.expiresAt,
        });
      } else if (result.status === 'expired') {
        dispatch({ type: 'EXPIRED', productId: result.productId });
      } else {
        dispatch({ type: 'REVOKED', productId: result.productId });
      }
    } catch (err) {
      dispatch({
        type: 'FAILED',
        error: err instanceof Error ? err.message : 'Refresh failed',
      });
    }
  }, []);

  // Reconcile on sign-in / account switch using any cached receipt.
  useEffect(() => {
    if (!user?.id) {
      return;
    }
    let cancelled = false;
    (async () => {
      const cached = await storage.get('pendingReceipt');
      if (cancelled || !cached) {
        return;
      }
      const parsed = JSON.parse(cached) as {
        receipt: string;
        productId: string;
      };
      dispatch({ type: 'PENDING', productId: parsed.productId });
      await reconcile(parsed.receipt, parsed.productId);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, reconcile]);

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      entitlement,
      // Premium is only granted on a server-verified entitlement.
      isPremium: entitlement.status === 'verified',
      isPending:
        entitlement.status === 'pending' || entitlement.status === 'verifying',
      restore,
      refresh,
    }),
    [entitlement, restore, refresh],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return ctx;
}
