/**
 * App-wide constants.
 *
 * Single source of truth for values that would otherwise be hardcoded across
 * services: API base URL and timeouts, pagination defaults, cache TTLs and
 * feature flags.
 *
 * Environment-backed values are resolved through `src/config/index.ts` so that
 * there is exactly one place reading `expoConfig.extra` / `process.env`. Import
 * these constants rather than redeclaring literals in a service.
 */

import config, { env } from './index';

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Base URL for all backend requests, selected by `APP_ENV` and read from the
 * `API_BASE_URL` / `STAGING_API_URL` / `PROD_API_URL` environment variables.
 * Already includes the `/api` prefix, so endpoint paths are root-relative.
 */
export const API_BASE_URL: string = config.api.baseUrl;

export const API = {
  baseUrl: API_BASE_URL,
  version: config.api.version,
  maxRetries: config.api.maxRetries,
} as const;

/** Request timeouts in milliseconds, by request class. */
export const TIMEOUTS = {
  /** Default timeout for standard JSON requests (`API_TIMEOUT`). */
  default: config.api.timeoutMs,
  /** Short timeout for lightweight health/version probes. */
  short: 5_000,
  /** Extended timeout for uploads and report generation. */
  upload: 60_000,
} as const;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Defaults applied to every paginated list request. */
export const PAGINATION = {
  /** Page size used when a caller does not specify one (`PAGINATION_LIMIT`). */
  defaultLimit: config.pagination.defaultLimit,
  /** Hard ceiling accepted by the backend — requests above this are rejected. */
  maxLimit: config.pagination.maxLimit,
  /** Zero-based index of the first page. */
  firstPage: 0,
  /** Distance from the end of a list that triggers the next fetch. */
  infiniteScrollThreshold: 5,
} as const;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Time-to-live values in milliseconds, grouped by how volatile the data is.
 * Prefer one of these over an inline duration so cache behaviour stays
 * consistent across services.
 */
export const CACHE_TTL = {
  /** Fallback TTL for anything without a more specific entry. */
  default: config.cache.ttlMs,
  /** Frequently changing data: vitals, live appointment status. */
  short: 2 * MINUTE_MS,
  /** Moderately stable data: pet lists, medication schedules. */
  medium: 15 * MINUTE_MS,
  /** Slow-moving data: user profile, clinic details. */
  long: HOUR_MS,
  /** Effectively static reference data: breeds, vaccination catalogues. */
  reference: 7 * DAY_MS,
} as const;

/** Maximum on-device cache size in megabytes (`MAX_CACHE_SIZE`). */
export const MAX_CACHE_SIZE_MB: number = config.cache.maxSizeMb;

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

const flag = (key: string, fallback: boolean): boolean =>
  env(key, String(fallback)).toLowerCase() === 'true';

/**
 * Runtime feature toggles. Each flag reads an environment variable so a build
 * can enable or disable a feature without a code change; the fallback is the
 * default for the current environment.
 */
export const FEATURE_FLAGS = {
  /** Telemedicine video consultations. */
  telemedicine: flag('FEATURE_TELEMEDICINE', true),
  /** On-chain anchoring of medical records and vaccination certificates. */
  blockchainAnchoring: flag('FEATURE_BLOCKCHAIN_ANCHORING', !config.isDev),
  /** Community forum and social feed. */
  community: flag('FEATURE_COMMUNITY', true),
  /** Stellar-backed payments and subscriptions. */
  stellarPayments: flag('FEATURE_STELLAR_PAYMENTS', !config.isDev),
  /** Referral and invite programme. */
  referrals: flag('FEATURE_REFERRALS', true),
  /** Verbose in-app debug tooling — development builds only by default. */
  debugMenu: flag('FEATURE_DEBUG_MENU', config.isDev),
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Timeouts = typeof TIMEOUTS;
export type Pagination = typeof PAGINATION;
export type CacheTtl = typeof CACHE_TTL;
export type FeatureFlags = typeof FEATURE_FLAGS;
export type FeatureFlag = keyof FeatureFlags;

/** Narrow helper for checking a flag by name. */
export const isFeatureEnabled = (feature: FeatureFlag): boolean => FEATURE_FLAGS[feature];
