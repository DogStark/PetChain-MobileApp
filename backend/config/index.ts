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
} as const;

export type AppConfig = typeof config;
export default config;
