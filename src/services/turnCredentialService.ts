import crypto from 'crypto';

/**
 * Ephemeral TURN credential issuing / rotation for telemedicine relay (RFC 5766
 * "REST API for TURN" pattern used by coturn).
 *
 * A credential is `username = <expiryUnix>:<principal>` and
 * `credential = base64(HMAC-SHA1(sharedSecret, username))`. The relay validates
 * the HMAC and the embedded expiry, so no long-lived secret ever reaches a
 * device and a leaked credential stops working when it expires.
 */

export interface TurnCredentials {
  username: string;
  credential: string;
  /** Seconds the credential remains valid from issue time. */
  ttl: number;
  /** Absolute expiry as a unix epoch (seconds). */
  expiresAt: number;
  urls: string[];
}

export interface IssueOptions {
  principal: string;
  sharedSecret: string;
  urls: string[];
  ttlSeconds?: number;
  /** Injectable clock for tests; unix epoch seconds. */
  nowSeconds?: number;
}

export const DEFAULT_TURN_TTL_SECONDS = 300;
/** Refresh once the credential is within this window of expiry. */
export const TURN_REFRESH_SKEW_SECONDS = 60;
const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 24 * 60 * 60;

function nowUnix(override?: number): number {
  return Math.floor(override ?? Date.now() / 1000);
}

function signUsername(username: string, sharedSecret: string): string {
  return crypto.createHmac('sha1', sharedSecret).update(username).digest('base64');
}

export function issueTurnCredentials(options: IssueOptions): TurnCredentials {
  const principal = options.principal.trim();
  if (!principal) throw new Error('principal is required to issue TURN credentials');
  if (!options.sharedSecret) throw new Error('sharedSecret is required to issue TURN credentials');
  if (!options.urls.length) throw new Error('at least one TURN url is required');

  const ttl = Math.min(
    MAX_TTL_SECONDS,
    Math.max(MIN_TTL_SECONDS, Math.floor(options.ttlSeconds ?? DEFAULT_TURN_TTL_SECONDS)),
  );
  const expiresAt = nowUnix(options.nowSeconds) + ttl;
  // Colons are the field separator; keep the principal opaque and delimiter-free.
  const safePrincipal = principal.replace(/[:\s]/g, '_');
  const username = `${expiresAt}:${safePrincipal}`;

  return {
    username,
    credential: signUsername(username, options.sharedSecret),
    ttl,
    expiresAt,
    urls: [...options.urls],
  };
}

export function credentialExpiry(username: string): number {
  const [expiry] = username.split(':', 1);
  const parsed = Number.parseInt(expiry ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function areCredentialsExpired(
  credentials: Pick<TurnCredentials, 'expiresAt'>,
  nowSeconds?: number,
): boolean {
  return nowUnix(nowSeconds) >= credentials.expiresAt;
}

export function credentialsNeedRefresh(
  credentials: Pick<TurnCredentials, 'expiresAt'>,
  nowSeconds?: number,
): boolean {
  return nowUnix(nowSeconds) >= credentials.expiresAt - TURN_REFRESH_SKEW_SECONDS;
}

/**
 * Verify a credential against the current secret and, during a rotation grace
 * window, the previous secret. Returns false for tampered or expired usernames.
 */
export function verifyTurnCredential(
  username: string,
  credential: string,
  secrets: { current: string; previous?: string },
  nowSeconds?: number,
): boolean {
  if (credentialExpiry(username) <= nowUnix(nowSeconds)) return false;
  const candidates = [secrets.current, secrets.previous].filter(Boolean) as string[];
  return candidates.some((secret) => {
    const expected = Buffer.from(signUsername(username, secret));
    const actual = Buffer.from(credential);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  });
}

type Fetcher = () => Promise<TurnCredentials>;

/**
 * Client-side manager that keeps a single live credential, refreshes it before
 * expiry, and transparently recovers an expired session by re-fetching.
 */
export class TurnCredentialManager {
  private current: TurnCredentials | null = null;
  private inFlight: Promise<TurnCredentials> | null = null;

  constructor(
    private readonly fetcher: Fetcher,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async getCredentials(forceRefresh = false): Promise<TurnCredentials> {
    const now = this.clock();
    if (
      !forceRefresh &&
      this.current &&
      !credentialsNeedRefresh(this.current, now)
    ) {
      return this.current;
    }
    if (!this.inFlight) {
      this.inFlight = this.fetcher()
        .then((creds) => {
          this.current = creds;
          return creds;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  /** Called when the relay rejects a session; drops the cached credential. */
  async recoverExpiredSession(): Promise<TurnCredentials> {
    this.current = null;
    return this.getCredentials(true);
  }

  peek(): TurnCredentials | null {
    return this.current;
  }
}
