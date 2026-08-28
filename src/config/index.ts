import Constants from 'expo-constants';
import {
  validateRuntimeConfig,
  shouldFailHardOnConfigError,
  logConfigWarnings,
  type RuntimeConfig as SchemaConfig,
} from './schema';

export type Environment = 'development' | 'staging' | 'production';

const extra = Constants.expoConfig?.extra ?? {};

// Resolve env — prefer expo extra (set via app.config.js), fall back to process.env
export function env(key: string, fallback = ''): string {
  return (extra[key] as string | undefined) ?? (process.env[key] as string | undefined) ?? fallback;
}

const APP_ENV = env('APP_ENV', 'development') as Environment;

const API_URLS: Record<Environment, string> = {
  development: env('API_BASE_URL', 'http://localhost:3000/api'),
  staging: env('STAGING_API_URL', 'https://staging.petchain.app/api'),
  production: env('PROD_API_URL', 'https://api.petchain.app/api'),
};

const API_TIMEOUT_MS = Number(env('API_TIMEOUT', '10000'));
const CACHE_SIZE_MB = Number(env('MAX_CACHE_SIZE', '50'));
const PAGINATION_LIMIT = Number(env('PAGINATION_LIMIT', '20'));
const MONITORING_SAMPLE_RATE = Number(env('MONITORING_SAMPLE_RATE', '1.0'));
const SESSION_TIMEOUT_MS = Number(env('SESSION_TIMEOUT_MS', String(30 * 60 * 1000)));
const CRASH_FREE_THRESHOLD = Number(env('CRASH_FREE_THRESHOLD', '99.5'));

// Validate runtime config before app starts
const validationResult = validateRuntimeConfig(
  {
    apiBaseUrl: API_URLS[APP_ENV],
    apiTimeoutMs: API_TIMEOUT_MS,
    cacheSizeMb: CACHE_SIZE_MB,
    paginationLimit: PAGINATION_LIMIT,
    monitoringSampleRate: MONITORING_SAMPLE_RATE,
    sessionTimeoutMs: SESSION_TIMEOUT_MS,
    crashFreeThreshold: CRASH_FREE_THRESHOLD,
  },
  APP_ENV,
);

if (!validationResult.isValid) {
  const failHard = shouldFailHardOnConfigError(APP_ENV);
  const message = `[Config] Validation failed:\n${validationResult.error}`;

  if (failHard) {
    throw new Error(message);
  } else {
    console.error(message);
  }
}

logConfigWarnings(validationResult.warnings);

const config = {
  env: APP_ENV,
  isDev: APP_ENV === 'development',
  isStaging: APP_ENV === 'staging',
  isProd: APP_ENV === 'production',

  api: {
    baseUrl: API_URLS[APP_ENV],
    timeoutMs: API_TIMEOUT_MS,
    maxRetries: 3,
    version: '2.0',
  },

  app: {
    name: env('APP_NAME', 'PetChain'),
    version: (Constants.expoConfig?.version as string | undefined) ?? env('APP_VERSION', '1.0.0'),
  },

  cache: {
    maxSizeMb: CACHE_SIZE_MB,
    ttlMs: 2 * 60 * 1000,
  },

  pagination: {
    defaultLimit: PAGINATION_LIMIT,
    maxLimit: 100,
  },

  monitoring: {
    /** Enable session monitoring (disabled in development by default) */
    enabled: env('MONITORING_ENABLED', APP_ENV === 'development' ? 'false' : 'true') === 'true',
    /** Sentry-compatible sample rate: 1.0 = 100% of sessions tracked */
    sampleRate: MONITORING_SAMPLE_RATE,
    /** Session idle timeout in ms — sessions inactive longer than this are auto-ended */
    sessionTimeoutMs: SESSION_TIMEOUT_MS,
    /** Crash-free rate threshold — alert fires when rate drops below this */
    crashFreeThreshold: CRASH_FREE_THRESHOLD,
  },
  sentry: {
    dsn: env('SENTRY_DSN', ''),
    enableInDev: env('SENTRY_ENABLE_IN_DEV', 'false') === 'true',
  },
  googlePlaces: {
    apiKey: env('GOOGLE_PLACES_API_KEY', ''),
  },
  pinLock: {
    /** Show remaining-attempts counter after this many failures */
    warnAfterAttempts: 3,
    /** Enforce cooldown after this many failures */
    cooldownAfterAttempts: 5,
    /** Cooldown duration in seconds */
    cooldownSeconds: 30,
    /** Wipe local session after this many total failures */
    wipeAfterAttempts: 10,
  },
} as const;

export type AppConfig = typeof config;
export default config;
