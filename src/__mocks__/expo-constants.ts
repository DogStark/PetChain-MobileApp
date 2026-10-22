/**
 * Manual mock for expo-constants.
 * Reads APP_ENV from process.env so tests can set it per-variant.
 */
const APP_ENV = (process.env.APP_ENV as string | undefined) ?? 'development';

const API_BASE_URL_MAP: Record<string, string> = {
  development: 'http://localhost:3000/api',
  staging: 'https://staging.petchain.app/api',
  production: 'https://api.petchain.app/api',
};

const Constants = {
  expoConfig: {
    version: '1.0.0',
    extra: {
      APP_ENV,
      API_BASE_URL:
        process.env.API_BASE_URL ?? API_BASE_URL_MAP[APP_ENV] ?? 'http://localhost:3000/api',
      STAGING_API_URL: process.env.STAGING_API_URL ?? 'https://staging.petchain.app/api',
      PROD_API_URL: process.env.PROD_API_URL ?? 'https://api.petchain.app/api',
      API_TIMEOUT: process.env.API_TIMEOUT ?? '10000',
      SENTRY_DSN: process.env.SENTRY_DSN ?? '',
      SENTRY_ENABLE_IN_DEV: process.env.SENTRY_ENABLE_IN_DEV ?? 'false',
      MAX_CACHE_SIZE: process.env.MAX_CACHE_SIZE ?? '50',
      PAGINATION_LIMIT: process.env.PAGINATION_LIMIT ?? '20',
    },
  },
};

export default Constants;
