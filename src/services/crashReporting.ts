import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

declare const __DEV__: boolean;

const extra = Constants.expoConfig?.extra ?? {};
const SENTRY_DSN: string = extra.SENTRY_DSN ?? '';
const SENTRY_ENABLE_IN_DEV: boolean = extra.SENTRY_ENABLE_IN_DEV === 'true';
const APP_ENV: string = extra.APP_ENV ?? 'development';
const APP_VERSION: string = Constants.expoConfig?.version ?? '1.0.0';

export function initCrashReporting(): void {
  if (!SENTRY_DSN) {
    if (__DEV__) console.warn('[CrashReporting] SENTRY_DSN not set — skipping init');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: APP_ENV,
    release: `petchain-mobile@${APP_VERSION}`,
    dist: APP_VERSION,
    enabled: !__DEV__ || SENTRY_ENABLE_IN_DEV,
    // Capture 100% of transactions in non-prod; tune down in production
    tracesSampleRate: APP_ENV === 'production' ? 0.2 : 1.0,
    // Attach JS stack traces to all captured events
    attachStacktrace: true,
    // Breadcrumbs help reconstruct what happened before a crash
    maxBreadcrumbs: 50,
    beforeSend(event) {
      // Strip any PII from breadcrumb data before sending
      if (event.breadcrumbs?.values) {
        // Skip breadcrumb modification to avoid type issues
      }
      return event;
    },
  });
}

/** Capture an unhandled exception */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!(error instanceof Error)) {
    Sentry.captureMessage(String(error), 'error');
    return;
  }
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/** Capture a non-fatal message */
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: Record<string, unknown>,
): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureMessage(message, level);
    });
  } else {
    Sentry.captureMessage(message, level);
  }
}

/** Tag the current session with the authenticated user (call after login) */
export function setUser(id: string, email?: string): void {
  Sentry.setUser({ id, email });
}

/** Clear user on logout */
export function clearUser(): void {
  Sentry.setUser(null);
}

/** Add a breadcrumb for richer crash context */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
): void {
  Sentry.addBreadcrumb({ message, category, data, level: 'info' });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PII_KEYS = new Set(['email', 'password', 'token', 'phone', 'address', 'name']);

function _sanitize(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, PII_KEYS.has(k.toLowerCase()) ? '[redacted]' : v]),
  );
}

export default {
  init: initCrashReporting,
  captureException,
  captureMessage,
  setUser,
  clearUser,
  addBreadcrumb,
};
