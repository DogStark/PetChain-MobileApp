// Environment type
type Environment = 'development' | 'staging' | 'production';

function getExpoVersion(): string {
  try {
    const Constants = require('expo-constants') as {
      expoConfig?: { version?: string };
    };
    return Constants.expoConfig?.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

// Determine current environment
const ENV: Environment = (process.env.APP_ENV as Environment) || 'development';

// Environment-specific API URLs
const API_URLS: Record<Environment, string> = {
  development: 'http://localhost:3000/api',
  staging: 'https://staging.petchain.app/api',
  production: 'https://api.petchain.app/api',
};

// App constants
const CONSTANTS = {
  TIMEOUT_MS: 10000, // 10 seconds
  MAX_RETRY_ATTEMPTS: 3,
  MAX_IMAGE_SIZE_MB: 5,
  PAGINATION_LIMIT: 20,
  TOKEN_EXPIRY_DAYS: 7,
} as const;

// Calendar-sync conflict policy for appointments (#1034)
// Controls how two-way calendar synchronization resolves conflicts between
// device-calendar events and PetChain appointments.
type CalendarSyncConflictPolicy =
  | 'device-wins'
  | 'app-wins'
  | 'newest-wins'
  | 'manual';

const CALENDAR_SYNC = {
  // When a conflict is detected, preserve both timestamps and require an
  // explicit resolution unless a deterministic policy is configured.
  conflictPolicy: (process.env.CALENDAR_SYNC_CONFLICT_POLICY as CalendarSyncConflictPolicy) || 'manual',
  // Persist external event IDs and source ownership so imports/exports are
  // idempotent and retries do not duplicate events.
  persistExternalEventIds: true,
  trackSourceOwnership: true,
  // Idempotency window (ms) used to dedupe retried sync operations.
  idempotencyWindowMs: Number(process.env.CALENDAR_SYNC_IDEMPOTENCY_WINDOW_MS) || 300000,
  // Sync recurring events and honor device timezone changes.
  syncRecurringEvents: true,
  respectTimezoneChanges: true,
  // Revoked calendar permissions pause sync until re-granted.
  pauseOnRevokedPermission: true,
} as const;

// Typed config object
const config = {
  env: ENV,
  isDev: ENV === 'development',
  isStaging: ENV === 'staging',
  isProd: ENV === 'production',

  api: {
    baseUrl: process.env.API_BASE_URL || API_URLS[ENV],
    timeout: CONSTANTS.TIMEOUT_MS,
    maxRetries: CONSTANTS.MAX_RETRY_ATTEMPTS,
  },

  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/petchain',
    poolSize: Number(process.env.DB_POOL_SIZE) || 20,
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT) || 30000,
  },

  app: {
    name: process.env.APP_NAME || 'PetChain',
    version: getExpoVersion(),
    maxImageSizeMB: CONSTANTS.MAX_IMAGE_SIZE_MB,
    paginationLimit: CONSTANTS.PAGINATION_LIMIT,
    tokenExpiryDays: CONSTANTS.TOKEN_EXPIRY_DAYS,
    jwtSecret: process.env.JWT_SECRET || 'petchain-dev-secret-key-change-in-prod',
  },

  calendarSync: CALENDAR_SYNC,
} as const;

export type AppConfig = typeof config;
export type { CalendarSyncConflictPolicy };
export default config;
