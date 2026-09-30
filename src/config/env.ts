/**
 * env.ts
 *
 * Typed environment-variable configuration module.
 *
 * All required variables are validated at module load time.  If any are
 * missing the module throws an error so the app fails fast at startup rather
 * than producing subtle runtime bugs.
 *
 * Import the exported `appConfig` singleton throughout the app instead of
 * reading `process.env` or `Constants.expoConfig?.extra` directly.
 */

import Constants from 'expo-constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppEnvironment = 'development' | 'staging' | 'production';

/** Full typed configuration object available to the app at runtime. */
export interface AppConfig {
  /** Active deployment environment */
  env: AppEnvironment;

  api: {
    /** Base REST API URL (includes /api prefix) */
    baseUrl: string;
    /** Request timeout in milliseconds */
    timeoutMs: number;
    /** Maximum automatic retry attempts */
    maxRetries: number;
  };

  app: {
    name: string;
    version: string;
  };

  auth: {
    /** JWT secret — only exposed in dev/test; absent in production builds */
    jwtSecret: string;
    /** TOTP seed encryption key (AES-256-GCM hex string) */
    totpEncryptionKey: string;
  };

  sentry: {
    dsn: string;
    authToken: string;
    org: string;
    project: string;
    enableInDev: boolean;
  };

  googlePlaces: {
    apiKey: string;
  };

  monitoring: {
    enabled: boolean;
    sampleRate: number;
    sessionTimeoutMs: number;
    crashFreeThreshold: number;
  };

  store: {
    iosUrl: string;
    androidUrl: string;
    minNativeVersionIos: string;
    minNativeVersionAndroid: string;
  };

  cache: {
    maxSizeMb: number;
    ttlMs: number;
  };

  pagination: {
    defaultLimit: number;
    maxLimit: number;
  };
}

// ─── Resolution helpers ───────────────────────────────────────────────────────

const extra = Constants.expoConfig?.extra ?? {};

/**
 * Read a variable from Expo `extra`, then fall back to `process.env`.
 * Returns `undefined` when neither source has the key.
 */
function read(key: string): string | undefined {
  const fromExtra = extra[key];
  if (typeof fromExtra === 'string' && fromExtra.length > 0) return fromExtra;
  const fromEnv = process.env[key];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return undefined;
}

/** Read with a fallback default value (never returns undefined). */
function readWithDefault(key: string, fallback: string): string {
  return read(key) ?? fallback;
}

/**
 * Read a *required* variable.  Throws at startup when it is missing so
 * mis-configured builds are caught immediately.
 */
function readRequired(key: string): string {
  const value = read(key);
  if (value == null) {
    throw new Error(
      `[env] Required environment variable "${key}" is not set. ` +
        'Check your .env file and app.config.js extra block.',
    );
  }
  return value;
}

// ─── Required variables list ──────────────────────────────────────────────────
//
// Add any new required variables here. The `readRequired` call will surface
// a clear startup error rather than a cryptic runtime failure.

const API_BASE_URL = readRequired('API_BASE_URL');

// ─── Build config ─────────────────────────────────────────────────────────────

const APP_ENV = readWithDefault('APP_ENV', 'development') as AppEnvironment;

const ENV_API_URLS: Record<AppEnvironment, string> = {
  development: API_BASE_URL,
  staging: readWithDefault('STAGING_API_URL', 'https://staging.petchain.app/api'),
  production: readWithDefault('PROD_API_URL', 'https://api.petchain.app/api'),
};

// ─── Exported config ──────────────────────────────────────────────────────────

const appConfig: AppConfig = {
  env: APP_ENV,

  api: {
    baseUrl: ENV_API_URLS[APP_ENV],
    timeoutMs: Number(readWithDefault('API_TIMEOUT', '10000')),
    maxRetries: 3,
  },

  app: {
    name: readWithDefault('APP_NAME', 'PetChain'),
    version:
      (Constants.expoConfig?.version as string | undefined) ??
      readWithDefault('APP_VERSION', '1.0.0'),
  },

  auth: {
    jwtSecret: readWithDefault('JWT_SECRET', ''),
    totpEncryptionKey: readWithDefault('TOTP_ENCRYPTION_KEY', ''),
  },

  sentry: {
    dsn: readWithDefault('SENTRY_DSN', ''),
    authToken: readWithDefault('SENTRY_AUTH_TOKEN', ''),
    org: readWithDefault('SENTRY_ORG', 'petchain'),
    project: readWithDefault('SENTRY_PROJECT', 'mobile-app'),
    enableInDev: readWithDefault('SENTRY_ENABLE_IN_DEV', 'false') === 'true',
  },

  googlePlaces: {
    apiKey: readWithDefault('GOOGLE_PLACES_API_KEY', ''),
  },

  monitoring: {
    enabled:
      readWithDefault('MONITORING_ENABLED', APP_ENV === 'development' ? 'false' : 'true') ===
      'true',
    sampleRate: Number(readWithDefault('MONITORING_SAMPLE_RATE', '1.0')),
    sessionTimeoutMs: Number(readWithDefault('SESSION_TIMEOUT_MS', String(30 * 60 * 1000))),
    crashFreeThreshold: Number(readWithDefault('CRASH_FREE_THRESHOLD', '99.5')),
  },

  store: {
    iosUrl: readWithDefault(
      'IOS_STORE_URL',
      'https://apps.apple.com/app/petchain/id000000000',
    ),
    androidUrl: readWithDefault(
      'ANDROID_STORE_URL',
      'https://play.google.com/store/apps/details?id=app.petchain.mobile',
    ),
    minNativeVersionIos: readWithDefault('MIN_NATIVE_VERSION_IOS', '1.0.0'),
    minNativeVersionAndroid: readWithDefault('MIN_NATIVE_VERSION_ANDROID', '1.0.0'),
  },

  cache: {
    maxSizeMb: Number(readWithDefault('MAX_CACHE_SIZE', '50')),
    ttlMs: 2 * 60 * 1000,
  },

  pagination: {
    defaultLimit: Number(readWithDefault('PAGINATION_LIMIT', '20')),
    maxLimit: 100,
  },
};

export default appConfig;
