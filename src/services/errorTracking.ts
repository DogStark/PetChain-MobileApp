/**
 * errorTracking.ts
 *
 * Centralised Sentry integration for PetChain.
 * Covers: initialisation, error/message capture, user context,
 * breadcrumbs (navigation, API, blockchain, login, sync, SOS),
 * and performance tracing for critical flows.
 */

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

// ─── Config ──────────────────────────────────────────────────────────────────

const extra = Constants.expoConfig?.extra ?? {};
const SENTRY_DSN: string = (extra.SENTRY_DSN as string | undefined) ?? '';
const SENTRY_ENABLE_IN_DEV: boolean = extra.SENTRY_ENABLE_IN_DEV === 'true';
const APP_ENV: string = (extra.APP_ENV as string | undefined) ?? 'development';
const APP_VERSION: string = Constants.expoConfig?.version ?? '1.0.0';

const TRACES_SAMPLE_RATE: Record<string, number> = {
  production: 0.2,
  staging: 0.5,
  development: 1.0,
};

// ─── PII and sensitive data sanitisation ──────────────────────────────────

export const REDACTED = '[redacted]';

// Sensitive key patterns: health, location, wallet, token
const SENSITIVE_KEY_PATTERNS = [
  // Health-related
  'health',
  'medical',
  'diagnosis',
  'treatment',
  'medicalhistory',
  'bloodtype',
  'vitals',
  'prescription',
  // Location-related
  'latitude',
  'longitude',
  'coordinates',
  'address',
  'location',
  'geolocation',
  'latlng',
  // Wallet and crypto-related
  'wallet',
  'address',
  'publickey',
  'contract',
  'balance',
  'ethereum',
  'blockchain',
  // Token and auth-related
  'token',
  'apikey',
  'sessionid',
  'refreshtoken',
  'authtoken',
  'secret',
  'password',
  'email',
  'phone',
];

export function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern));
}

/**
 * Recursively redact sensitive fields from an object using an allowlist approach.
 * Top-level keys are checked; nested objects/arrays are traversed and their
 * sensitive fields are also redacted.
 */
export function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }

  if (typeof data !== 'object') {
    return data;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveData(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Deprecated: kept for backward compatibility
const PII_KEYS = new Set(['email', 'password', 'token', 'phone', 'address', 'name', 'secret']);

function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, PII_KEYS.has(k.toLowerCase()) ? REDACTED : v]),
  );
}

// ─── Initialisation ──────────────────────────────────────────────────────────

export function init(): void {
  if (!SENTRY_DSN) {
    // __DEV__ is defined by Metro bundler; guard for Jest/Node environments
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[ErrorTracking] SENTRY_DSN not set — skipping init');
    }
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: APP_ENV,
    release: `petchain-mobile@${APP_VERSION}`,
    dist: APP_VERSION,
    enabled: !(typeof __DEV__ !== 'undefined' && __DEV__) || SENTRY_ENABLE_IN_DEV,
    tracesSampleRate: TRACES_SAMPLE_RATE[APP_ENV] ?? 1.0,
    attachStacktrace: true,
    maxBreadcrumbs: 100,
    beforeSend(event) {
      // Redact sensitive health, location, wallet, and token data from extras
      if (event.extra) {
        event.extra = redactSensitiveData(event.extra);
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      // Redact sensitive data from breadcrumb context
      if (breadcrumb.data && typeof breadcrumb.data === 'object') {
        breadcrumb.data = redactSensitiveData(breadcrumb.data);
      }
      return breadcrumb;
    },
  });
}

// ─── Error / message capture ─────────────────────────────────────────────────

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!(error instanceof Error)) {
    Sentry.captureMessage(String(error), 'error');
    return;
  }
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(redactSensitiveData(context));
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: Record<string, unknown>,
): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(redactSensitiveData(context));
      Sentry.captureMessage(message, level);
    });
  } else {
    Sentry.captureMessage(message, level);
  }
}

// ─── User context ─────────────────────────────────────────────────────────────

export interface UserContext {
  id: string;
  email?: string;
  petCount?: number;
  subscriptionTier?: 'free' | 'premium';
}

export function setUser(ctx: UserContext): void {
  const { id, email, petCount, subscriptionTier } = ctx;
  // id is required; email is optional but must not be undefined in Sentry user
  Sentry.setUser({ id, ...(email ? { email } : {}) });
  Sentry.setContext('app_user', {
    petCount: petCount ?? null,
    subscriptionTier: subscriptionTier ?? null,
  });
}

export function clearUser(): void {
  Sentry.setUser(null);
  Sentry.setContext('app_user', null);
}

// ─── Breadcrumbs ─────────────────────────────────────────────────────────────

/** Navigation: called when the active screen changes */
export function breadcrumbNavigation(routeName: string, params?: Record<string, unknown>): void {
  Sentry.addBreadcrumb({
    category: 'navigation',
    message: `Navigated to ${routeName}`,
    data: params ? (redactSensitiveData(params) as Record<string, unknown>) : undefined,
    level: 'info',
  });
}

/** API: outgoing request */
export function breadcrumbApiRequest(method: string, url: string): void {
  Sentry.addBreadcrumb({
    category: 'api.request',
    message: `${method.toUpperCase()} ${url}`,
    level: 'info',
  });
}

/** API: response received */
export function breadcrumbApiResponse(
  method: string,
  url: string,
  status: number,
  durationMs?: number,
): void {
  Sentry.addBreadcrumb({
    category: 'api.response',
    message: `${method.toUpperCase()} ${url} → ${status}`,
    data: durationMs !== undefined ? { durationMs } : undefined,
    level: status >= 400 ? 'warning' : 'info',
  });
}

/** Blockchain: transaction lifecycle */
export function breadcrumbBlockchain(
  event: 'submit' | 'confirmed' | 'failed',
  txHash?: string,
): void {
  Sentry.addBreadcrumb({
    category: 'blockchain',
    message: `Transaction ${event}${txHash ? `: ${txHash}` : ''}`,
    level: event === 'failed' ? 'error' : 'info',
  });
}

/** Auth: login / logout */
export function breadcrumbAuth(action: 'login' | 'logout' | 'login_failed'): void {
  Sentry.addBreadcrumb({
    category: 'auth',
    message: action,
    level: action === 'login_failed' ? 'warning' : 'info',
  });
}

/** Sync: record synchronisation */
export function breadcrumbSync(event: 'start' | 'complete' | 'failed', recordCount?: number): void {
  Sentry.addBreadcrumb({
    category: 'sync',
    message: `Sync ${event}`,
    data: recordCount !== undefined ? { recordCount } : undefined,
    level: event === 'failed' ? 'error' : 'info',
  });
}

/** SOS: emergency trigger */
export function breadcrumbSOS(event: 'triggered' | 'sent' | 'failed'): void {
  Sentry.addBreadcrumb({
    category: 'sos',
    message: `SOS ${event}`,
    level: event === 'failed' ? 'error' : 'warning',
  });
}

// ─── Performance tracing ─────────────────────────────────────────────────────

type TransactionOp = 'login' | 'sync' | 'sos' | 'blockchain';

/**
 * Start a performance transaction for a critical flow.
 * Returns a finish function — call it when the flow completes.
 *
 * Usage:
 *   const finish = startTransaction('login');
 *   // ... do work ...
 *   finish('ok');
 */
export function startTransaction(op: TransactionOp, name?: string): (status?: string) => void {
  const txName = name ?? op;
  const transaction = ((Sentry as any).startTransaction ?? (Sentry as any).startSpan)({
    name: txName,
    op,
  });
  (Sentry as any)
    .getCurrentHub?.()
    .configureScope((scope: { setSpan: (span: unknown) => void }) => scope.setSpan(transaction));

  return (status = 'ok') => {
    transaction?.setStatus?.(status);
    transaction?.finish?.();
    (Sentry as any)
      .getCurrentHub?.()
      .configureScope((scope: { setSpan: (span: unknown) => void }) => scope.setSpan(undefined));
  };
}

// ─── Default export (object API, mirrors crashReporting.ts) ──────────────────

const errorTracking = {
  init,
  captureException,
  captureMessage,
  setUser,
  clearUser,
  breadcrumbNavigation,
  breadcrumbApiRequest,
  breadcrumbApiResponse,
  breadcrumbBlockchain,
  breadcrumbAuth,
  breadcrumbSync,
  breadcrumbSOS,
  startTransaction,
};

export default errorTracking;
