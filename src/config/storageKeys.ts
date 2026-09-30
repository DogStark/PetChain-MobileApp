/**
 * Centralized AsyncStorage keys for auth-related values.
 */
export const storageKeys = {
  auth: {
    /** Access token used for authenticated API requests. */
    accessToken: '@auth/access_token',
    /** Refresh token used to acquire a new access token. */
    refreshToken: '@auth/refresh_token',
    /** Persisted snapshot of the current auth session. */
    session: '@auth/session',
  },
  pets: {
    /** Cached list of pets for the current user. */
    list: '@pets/list',
    /** Prefix for per-pet cached detail entries. */
    detailPrefix: '@pets/detail:',
  },
  cache: {
    /** Cached app theme mode. */
    themeMode: '@cache/theme_mode',
    /** Cached geofence alerts. */
    geofenceAlerts: '@cache/geofence_alerts',
  },
  sync: {
    /** Pending sync queue state. */
    pendingQueue: '@sync/pending_queue',
    /** Backoff state for sync retries. */
    backoff: '@sync/backoff',
  },
  stellar: {
    /**
     * Submitted-but-unconfirmed Stellar transactions (issue #947).
     *
     * Holds signed envelopes only. A signed envelope carries the source public
     * key and a signature — it is the same data the network sees, and contains
     * no secret key. The secret stays in secure storage and is never written
     * here.
     */
    pendingTransactions: '@stellar/pending_transactions',
  },
} as const;
