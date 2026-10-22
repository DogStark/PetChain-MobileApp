/**
 * Network profile validation (issue #943).
 *
 * The issue asks for "one immutable validated network profile and environment
 * tests". These are those environment tests.
 *
 * ## Characterising the behaviour being replaced
 *
 * Before this profile existed, two modules chose the network independently:
 *
 *   - `blockchainService.ts` had `const STELLAR_NETWORK = 'TESTNET'` hard-coded
 *     and derived the Horizon URL and passphrase from it.
 *   - `stellarPathPaymentService.signTransactionXdr` used
 *     `config.env === 'production' ? Networks.PUBLIC : Networks.TESTNET`.
 *
 * With `APP_ENV=production` those disagree: transactions were signed with the
 * **public** passphrase and submitted to **testnet** Horizon. A passphrase is
 * part of what a Stellar signature commits to, so the two must never be chosen
 * separately. `rejects a public passphrase on a testnet profile` and
 * `rejects a testnet Horizon for the public network` pin down that exact
 * mismatch.
 */

import { StellarNetworkConfigError, resolveStellarNetworkProfile } from '../stellarNetwork';

const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

describe('network defaults per environment', () => {
  it('defaults development to testnet', () => {
    const profile = resolveStellarNetworkProfile({ env: 'development' });

    expect(profile.network).toBe('TESTNET');
    expect(profile.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    expect(profile.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(profile.isProduction).toBe(false);
  });

  it('defaults production to the public network', () => {
    const profile = resolveStellarNetworkProfile({ env: 'production' });

    expect(profile.network).toBe('PUBLIC');
    expect(profile.horizonUrl).toBe('https://horizon.stellar.org');
    expect(profile.networkPassphrase).toBe(PUBLIC_PASSPHRASE);
    expect(profile.isProduction).toBe(true);
  });

  it('accepts MAINNET as an alias for PUBLIC', () => {
    expect(resolveStellarNetworkProfile({ env: 'production', network: 'mainnet' }).network).toBe(
      'PUBLIC',
    );
  });

  it('is case- and whitespace-insensitive', () => {
    expect(
      resolveStellarNetworkProfile({ env: 'development', network: '  TestNet ' }).network,
    ).toBe('TESTNET');
  });
});

describe('the profile is immutable', () => {
  it('cannot be mutated after resolution', () => {
    const profile = resolveStellarNetworkProfile({ env: 'development' });

    expect(Object.isFrozen(profile)).toBe(true);

    // Assert the guarantee rather than the mechanism: a write to a frozen
    // object throws in strict mode but silently no-ops in sloppy mode, and
    // which one applies depends on the transpiler. What matters either way is
    // that the value cannot change.
    try {
      (profile as { network: string }).network = 'PUBLIC';
    } catch {
      // Strict mode: throwing is also acceptable.
    }
    expect(profile.network).toBe('TESTNET');
  });
});

describe('mismatched network and passphrase', () => {
  it('rejects a public passphrase on a testnet profile', () => {
    expect(() =>
      resolveStellarNetworkProfile({
        env: 'development',
        network: 'TESTNET',
        networkPassphrase: PUBLIC_PASSPHRASE,
      }),
    ).toThrow(StellarNetworkConfigError);
  });

  it('rejects a testnet passphrase on a public profile', () => {
    expect(() =>
      resolveStellarNetworkProfile({
        env: 'production',
        network: 'PUBLIC',
        networkPassphrase: TESTNET_PASSPHRASE,
      }),
    ).toThrow(/passphrase does not match/);
  });
});

describe('mismatched network and Horizon host', () => {
  it('rejects a testnet Horizon for the public network', () => {
    expect(() =>
      resolveStellarNetworkProfile({
        env: 'production',
        network: 'PUBLIC',
        horizonUrl: 'https://horizon-testnet.stellar.org',
      }),
    ).toThrow(/belongs to TESTNET but the network is PUBLIC/);
  });

  it('rejects a public Horizon for testnet', () => {
    expect(() =>
      resolveStellarNetworkProfile({
        env: 'development',
        network: 'TESTNET',
        horizonUrl: 'https://horizon.stellar.org',
      }),
    ).toThrow(/belongs to PUBLIC but the network is TESTNET/);
  });

  it('rejects an unknown Horizon host', () => {
    expect(() =>
      resolveStellarNetworkProfile({
        env: 'development',
        horizonUrl: 'https://horizon.example.com',
      }),
    ).toThrow(/not a known TESTNET host/);
  });

  it('rejects a non-https Horizon URL', () => {
    expect(() =>
      resolveStellarNetworkProfile({
        env: 'development',
        horizonUrl: 'http://horizon-testnet.stellar.org',
      }),
    ).toThrow(/must use https/);
  });

  it('rejects a malformed Horizon URL', () => {
    expect(() =>
      resolveStellarNetworkProfile({ env: 'development', horizonUrl: 'not a url' }),
    ).toThrow(/not a valid URL/);
  });

  it('treats an unset override as absent rather than as an empty value', () => {
    // Env vars arrive as '' when unset; that must fall back to the default.
    expect(resolveStellarNetworkProfile({ env: 'development', horizonUrl: '' }).horizonUrl).toBe(
      'https://horizon-testnet.stellar.org',
    );
  });
});

describe('environment and network must agree', () => {
  it('refuses the public network outside production by default', () => {
    expect(() => resolveStellarNetworkProfile({ env: 'development', network: 'PUBLIC' })).toThrow(
      /not allowed in the "development" environment/,
    );
  });

  it('allows the public network outside production only on explicit opt-in', () => {
    const profile = resolveStellarNetworkProfile({
      env: 'staging',
      network: 'PUBLIC',
      allowPublicOutsideProduction: true,
    });
    expect(profile.network).toBe('PUBLIC');
  });

  it('refuses testnet in production', () => {
    expect(() => resolveStellarNetworkProfile({ env: 'production', network: 'TESTNET' })).toThrow(
      /must not run against testnet/,
    );
  });

  it('rejects an unrecognised network name', () => {
    expect(() =>
      resolveStellarNetworkProfile({ env: 'development', network: 'futurenet' }),
    ).toThrow(/must be "PUBLIC" or "TESTNET"/);
  });
});

describe('friendbot availability follows the network', () => {
  it('is available on testnet', () => {
    expect(resolveStellarNetworkProfile({ env: 'development' }).friendbotUrl).toBe(
      'https://friendbot.stellar.org',
    );
  });

  it('is absent on the public network', () => {
    expect(resolveStellarNetworkProfile({ env: 'production' }).friendbotUrl).toBeNull();
  });
});

describe('error reporting', () => {
  it('reports every problem at once rather than one at a time', () => {
    let error: StellarNetworkConfigError | undefined;
    try {
      resolveStellarNetworkProfile({
        env: 'development',
        network: 'PUBLIC',
        horizonUrl: 'http://horizon-testnet.stellar.org',
        networkPassphrase: TESTNET_PASSPHRASE,
      });
    } catch (caught) {
      error = caught as StellarNetworkConfigError;
    }

    expect(error).toBeInstanceOf(StellarNetworkConfigError);
    // public-outside-production, non-https, wrong-network host, wrong passphrase
    expect(error!.problems.length).toBeGreaterThanOrEqual(4);
  });

  it('names the offending value in the message', () => {
    expect(() => resolveStellarNetworkProfile({ env: 'development', network: 'nope' })).toThrow(
      /"nope"/,
    );
  });
});
