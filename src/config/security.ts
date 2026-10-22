/**
 * SSL Pinning & Certificate Transparency configuration
 *
 * SHA-256 fingerprints of the API server's TLS certificate(s).
 * Include both the active cert and the next rotation cert so deploys
 * are zero-downtime.
 *
 * To obtain a fingerprint:
 *   openssl s_client -connect api.petchain.app:443 </dev/null 2>/dev/null \
 *     | openssl x509 -noout -fingerprint -sha256
 *
 * Expiry dates (ISO 8601) help monitor for upcoming rotation needs.
 * Pins are checked well before expiry to ensure smooth rotation windows.
 */

export interface PinSet {
  pin: string;
  expiryDate?: string; // ISO 8601 date (e.g. "2026-12-31")
  role: 'primary' | 'backup';
}

export const SSL_PINS: Record<string, PinSet[]> = {
  'api.petchain.app': [
    {
      pin: 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      expiryDate: '2026-12-31',
      role: 'primary',
    },
    {
      pin: 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
      expiryDate: '2027-12-31',
      role: 'backup',
    },
  ],
  'staging.petchain.app': [
    {
      pin: 'sha256/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=',
      expiryDate: '2026-06-30',
      role: 'primary',
    },
  ],
};

/** Domains that require certificate pinning */
export const PINNED_DOMAINS = Object.keys(SSL_PINS);

/** Extract pin strings for backward compatibility with pinning libraries */
export const SSL_PIN_STRINGS: Record<string, string[]> = Object.entries(SSL_PINS).reduce(
  (acc, [domain, pinSets]) => {
    acc[domain] = pinSets.map((ps) => ps.pin);
    return acc;
  },
  {} as Record<string, string[]>,
);

/**
 * How long (ms) to cache a successful pin validation before re-checking.
 * Keeps UX snappy while still catching rotations promptly.
 */
export const PIN_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * How many days before expiry to warn about upcoming pin rotation.
 * Early warning helps catch rotation issues before they impact users.
 */
export const PIN_EXPIRY_WARNING_DAYS = 7;

/**
 * Support contact shown to the user when a pin failure occurs.
 * A pin failure almost always means a MITM attack or an expired cert.
 */
export const PIN_FAILURE_SUPPORT_URL = 'https://petchain.app/support';

/**
 * Certificate Transparency: minimum number of SCTs required.
 * Set to 0 to disable CT enforcement (not recommended for production).
 */
export const CT_MIN_SCTS = 2;
