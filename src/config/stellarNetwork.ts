/**
 * One immutable, validated Stellar network profile (issue #943).
 *
 * ## Why this exists
 *
 * Network selection used to be made independently in two places that could
 * disagree:
 *
 *   - `services/blockchainService.ts` hard-coded `const STELLAR_NETWORK = 'TESTNET'`
 *     and derived the Horizon URL and passphrase from it.
 *   - `services/stellarPathPaymentService.ts` derived the signing passphrase
 *     from `config.env === 'production'`.
 *
 * A production build therefore signed with the **public** network passphrase
 * while every Horizon call went to **testnet**. The passphrase is part of what
 * a Stellar signature commits to, so mixing them produces transactions that are
 * invalid on the network they were sent to — or, in the dangerous direction,
 * real-value transactions submitted from a build everyone believes is a test
 * build. Those mistakes are irreversible.
 *
 * The fix is that neither the network name, the Horizon URL, nor the passphrase
 * may be chosen separately. They are resolved together, validated as a unit,
 * and frozen.
 */

import { Networks } from '@stellar/stellar-sdk';

import config, { type Environment } from './index';

export type StellarNetworkName = 'PUBLIC' | 'TESTNET';

/** A resolved, validated, immutable network profile. */
export interface StellarNetworkProfile {
  readonly network: StellarNetworkName;
  readonly horizonUrl: string;
  readonly networkPassphrase: string;
  /** Friendbot funding endpoint. Testnet only; `null` on public. */
  readonly friendbotUrl: string | null;
  /** True when this profile moves real value. */
  readonly isProduction: boolean;
}

/** Thrown when a network configuration is internally inconsistent. */
export class StellarNetworkConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid Stellar network configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'StellarNetworkConfigError';
  }
}

/**
 * Horizon hosts we accept per network.
 *
 * An allowlist rather than a substring check: "horizon-testnet.stellar.org" and
 * "horizon.stellar.org" differ by a prefix, so a typo silently pointing a
 * production build at testnet is exactly the class of mistake being prevented.
 */
const KNOWN_HORIZON_HOSTS: Record<StellarNetworkName, readonly string[]> = {
  PUBLIC: ['horizon.stellar.org'],
  TESTNET: ['horizon-testnet.stellar.org'],
};

const DEFAULT_HORIZON_URL: Record<StellarNetworkName, string> = {
  PUBLIC: 'https://horizon.stellar.org',
  TESTNET: 'https://horizon-testnet.stellar.org',
};

const FRIENDBOT_URL: Record<StellarNetworkName, string | null> = {
  PUBLIC: null,
  TESTNET: 'https://friendbot.stellar.org',
};

/** The canonical passphrase for each network, straight from the SDK. */
const CANONICAL_PASSPHRASE: Record<StellarNetworkName, string> = {
  PUBLIC: Networks.PUBLIC,
  TESTNET: Networks.TESTNET,
};

export interface ResolveNetworkInput {
  /** App environment. Decides which network is *permitted*. */
  env: Environment;
  /** Explicit network override, normally from `STELLAR_NETWORK`. */
  network?: string;
  /** Explicit Horizon override, normally from `STELLAR_HORIZON_URL`. */
  horizonUrl?: string;
  /**
   * Explicit passphrase override. Provided only so a misconfiguration can be
   * *detected* in tests; a mismatch is always an error.
   */
  networkPassphrase?: string;
  /**
   * Escape hatch for staging environments that deliberately point at mainnet.
   * Requires an explicit opt-in so it can never happen by accident.
   */
  allowPublicOutsideProduction?: boolean;
}

function normaliseNetworkName(
  raw: string | undefined,
  env: Environment,
): StellarNetworkName | null {
  if (raw === undefined || raw === '') {
    // Default: only a production build defaults to the public network.
    return env === 'production' ? 'PUBLIC' : 'TESTNET';
  }
  const upper = raw.trim().toUpperCase();
  if (upper === 'PUBLIC' || upper === 'MAINNET') return 'PUBLIC';
  if (upper === 'TESTNET') return 'TESTNET';
  return null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Resolve and validate a network profile.
 *
 * Collects *every* problem rather than throwing on the first, so a
 * misconfiguration is fixed in one pass instead of one error at a time.
 *
 * @throws {StellarNetworkConfigError}
 */
export function resolveStellarNetworkProfile(input: ResolveNetworkInput): StellarNetworkProfile {
  const problems: string[] = [];

  const network = normaliseNetworkName(input.network, input.env);
  if (network === null) {
    throw new StellarNetworkConfigError([
      `STELLAR_NETWORK must be "PUBLIC" or "TESTNET" (got ${JSON.stringify(input.network)})`,
    ]);
  }

  // ── Environment / network agreement ──────────────────────────────────────
  if (network === 'PUBLIC' && input.env !== 'production' && !input.allowPublicOutsideProduction) {
    problems.push(
      `the public network moves real value and is not allowed in the "${input.env}" environment ` +
        '(set allowPublicOutsideProduction to override deliberately)',
    );
  }
  if (network === 'TESTNET' && input.env === 'production') {
    problems.push(
      'a production build must not run against testnet — payments would silently be worthless',
    );
  }

  // ── Horizon ──────────────────────────────────────────────────────────────
  // An unset env var arrives as '', which must fall back to the default rather
  // than being treated as an explicit empty override.
  const horizonOverride = input.horizonUrl?.trim() ? input.horizonUrl.trim() : undefined;
  const horizonUrl = horizonOverride ?? DEFAULT_HORIZON_URL[network];
  const host = hostOf(horizonUrl);

  if (host === null) {
    problems.push(`Horizon URL is not a valid URL: ${JSON.stringify(horizonUrl)}`);
  } else {
    if (!horizonUrl.toLowerCase().startsWith('https://')) {
      problems.push(`Horizon URL must use https (got ${JSON.stringify(horizonUrl)})`);
    }
    const permitted = KNOWN_HORIZON_HOSTS[network];
    const other: StellarNetworkName = network === 'PUBLIC' ? 'TESTNET' : 'PUBLIC';
    if (!permitted.includes(host)) {
      if (KNOWN_HORIZON_HOSTS[other].includes(host)) {
        // The exact mistake this module exists to prevent.
        problems.push(
          `Horizon host "${host}" belongs to ${other} but the network is ${network} — ` +
            'transactions would be signed for one network and submitted to the other',
        );
      } else {
        problems.push(
          `Horizon host "${host}" is not a known ${network} host ` +
            `(expected one of: ${permitted.join(', ')})`,
        );
      }
    }
  }

  // ── Passphrase ───────────────────────────────────────────────────────────
  const canonical = CANONICAL_PASSPHRASE[network];
  const networkPassphrase = input.networkPassphrase ?? canonical;
  if (networkPassphrase !== canonical) {
    problems.push(
      `network passphrase does not match ${network}; a signature made with the wrong ` +
        'passphrase is invalid on the target network',
    );
  }

  if (problems.length > 0) {
    throw new StellarNetworkConfigError(problems);
  }

  return Object.freeze({
    network,
    horizonUrl,
    networkPassphrase,
    friendbotUrl: FRIENDBOT_URL[network],
    isProduction: network === 'PUBLIC',
  });
}

// ── Application singleton ──────────────────────────────────────────────────

let cached: StellarNetworkProfile | null = null;

/**
 * The app's network profile. Resolved once and frozen.
 *
 * Deliberately throws on a bad configuration rather than falling back to a
 * default: a wrong-network default is precisely the irreversible mistake here.
 */
export function getStellarNetworkProfile(): StellarNetworkProfile {
  if (cached === null) {
    cached = resolveStellarNetworkProfile({
      env: config.env,
      network: config.stellar?.network,
      horizonUrl: config.stellar?.horizonUrl,
      allowPublicOutsideProduction: config.stellar?.allowPublicOutsideProduction,
    });
  }
  return cached;
}

/** Test hook — clears the memoised profile. */
export function __resetStellarNetworkProfile(): void {
  cached = null;
}
