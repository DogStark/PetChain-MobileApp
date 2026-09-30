/**
 * Transaction review before signing (issue #945).
 *
 * These build **real** transaction envelopes with the Stellar SDK and decode
 * them back, so the review path is exercised end to end rather than against a
 * hand-written fixture that could drift from the real XDR format.
 *
 * All keys are SDK-generated throw-away keypairs — synthetic data only, and no
 * secret is ever asserted on or logged.
 */

// The repo ships a manual mock at src/__mocks__/@stellar/stellar-sdk.ts, which
// Jest applies automatically. These tests deliberately exercise the real SDK:
// building and decoding an actual XDR envelope is the whole point, and a mocked
// decoder would prove nothing about the review path.
jest.unmock('@stellar/stellar-sdk');

import * as StellarSdk from '@stellar/stellar-sdk';

import {
  QUOTE_EXPIRY_WARNING_MS,
  TransactionSimulationError,
  canSignQuote,
  compareQuoteToSimulation,
  evaluateQuoteFreshness,
  simulateTransactionXdr,
} from '../transactionSimulation';
import type { PathPaymentQuote } from '../stellarPathPaymentService';

const TESTNET = StellarSdk.Networks.TESTNET;
const PUBLIC = StellarSdk.Networks.PUBLIC;

const source = StellarSdk.Keypair.random();
const destination = StellarSdk.Keypair.random();

function buildPaymentXdr(
  options: {
    amount?: string;
    memo?: string;
    network?: string;
    fee?: string;
    sign?: boolean;
  } = {},
): string {
  const account = new StellarSdk.Account(source.publicKey(), '1234567890');
  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: options.fee ?? '100',
    networkPassphrase: options.network ?? TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: destination.publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: options.amount ?? '25.0000000',
      }),
    )
    .setTimeout(180);

  if (options.memo) builder.addMemo(StellarSdk.Memo.text(options.memo));

  const tx = builder.build();
  if (options.sign) tx.sign(source);
  return tx.toXDR();
}

function quoteFixture(overrides: Partial<PathPaymentQuote> = {}): PathPaymentQuote {
  return {
    paymentId: 'pay-1',
    plan: 'premium_monthly' as PathPaymentQuote['plan'],
    userId: 'user-1',
    sourceAsset: { code: 'XLM', type: 'native' },
    destinationAsset: { code: 'XLM', type: 'native' },
    destinationAmount: '25.0000000',
    sourceAmount: '25.0000000',
    exchangeRate: '1',
    estimatedNetworkFee: '0.00001',
    mode: 'direct-xlm',
    path: [],
    pathCount: 0,
    createdAt: '2026-08-25T12:00:00.000Z',
    expiresAt: '2026-08-25T12:05:00.000Z',
    ...overrides,
  } as PathPaymentQuote;
}

// ── Decoding what will actually be signed ──────────────────────────────────

describe('decoding the envelope', () => {
  it('reports destination, asset, amount, fee, memo and network', () => {
    const sim = simulateTransactionXdr(buildPaymentXdr({ memo: 'petchain' }), TESTNET);

    expect(sim.sourceAccount).toBe(source.publicKey());
    expect(sim.operationCount).toBe(1);
    expect(sim.operations[0].destination).toBe(destination.publicKey());
    expect(sim.operations[0].sendAsset).toBe('XLM');
    expect(sim.operations[0].destinationAmount).toBe('25.0000000');
    expect(sim.feeStroops).toBe('100');
    expect(sim.feeXlm).toBe('0.00001');
    expect(sim.memo).toEqual({ type: 'text', value: 'petchain' });
    expect(sim.network).toBe('TESTNET');
  });

  it('reports an absent memo as none rather than omitting it', () => {
    const sim = simulateTransactionXdr(buildPaymentXdr(), TESTNET);
    expect(sim.memo).toEqual({ type: 'none', value: null });
  });

  it('identifies the public network', () => {
    const sim = simulateTransactionXdr(buildPaymentXdr({ network: PUBLIC }), PUBLIC);
    expect(sim.network).toBe('PUBLIC');
  });

  it('reports an unrecognised passphrase as UNKNOWN rather than guessing', () => {
    const xdr = buildPaymentXdr({ network: 'Some Private Network ; 2026' });
    const sim = simulateTransactionXdr(xdr, 'Some Private Network ; 2026');
    expect(sim.network).toBe('UNKNOWN');
  });

  it('counts attached signatures', () => {
    expect(simulateTransactionXdr(buildPaymentXdr(), TESTNET).signatureCount).toBe(0);
    expect(simulateTransactionXdr(buildPaymentXdr({ sign: true }), TESTNET).signatureCount).toBe(1);
  });

  it('converts the fee to XLM for display', () => {
    const sim = simulateTransactionXdr(buildPaymentXdr({ fee: '20000' }), TESTNET);
    expect(sim.feeStroops).toBe('20000');
    expect(sim.feeXlm).toBe('0.002');
  });

  // Malformed-input path from the acceptance criteria.
  it.each([
    ['empty', ''],
    ['not base64', 'this is not xdr'],
    ['truncated', buildPaymentXdr().slice(0, 24)],
  ])('raises a review error for %s XDR instead of silently proceeding', (_label, xdr) => {
    expect(() => simulateTransactionXdr(xdr, TESTNET)).toThrow(TransactionSimulationError);
  });
});

// ── Quote vs. envelope agreement ───────────────────────────────────────────

describe('comparing the quote to the envelope', () => {
  it('reports no discrepancy when they agree', () => {
    const sim = simulateTransactionXdr(buildPaymentXdr({ amount: '25.0000000' }), TESTNET);
    expect(compareQuoteToSimulation(quoteFixture(), sim, 'TESTNET')).toEqual([]);
  });

  it('blocks when the envelope sends a different amount than displayed', () => {
    // The core hazard: reassuring summary, different bytes.
    const sim = simulateTransactionXdr(buildPaymentXdr({ amount: '250.0000000' }), TESTNET);
    const problems = compareQuoteToSimulation(quoteFixture(), sim, 'TESTNET');

    // A native payment's amount is both what leaves and what arrives, so both
    // the destination and source checks fire. Either alone must block signing.
    expect(problems.length).toBeGreaterThanOrEqual(1);
    expect(problems.every((p) => p.severity === 'blocking')).toBe(true);

    const destination = problems.find((p) => p.field === 'destinationAmount');
    expect(destination).toBeDefined();
    expect(destination!.message).toContain('250');
  });

  it('blocks when the envelope targets a different network than configured', () => {
    const sim = simulateTransactionXdr(buildPaymentXdr({ network: PUBLIC }), PUBLIC);
    const problems = compareQuoteToSimulation(quoteFixture(), sim, 'TESTNET');

    expect(problems.some((p) => p.field === 'network' && p.severity === 'blocking')).toBe(true);
  });

  it('does not flag equivalent amounts written differently', () => {
    const sim = simulateTransactionXdr(buildPaymentXdr({ amount: '25.0000000' }), TESTNET);
    const problems = compareQuoteToSimulation(
      quoteFixture({ destinationAmount: '25' }),
      sim,
      'TESTNET',
    );
    expect(problems).toEqual([]);
  });
});

// ── Stale-quote expiry ─────────────────────────────────────────────────────

describe('quote freshness', () => {
  const expiresAt = '2026-08-25T12:05:00.000Z';
  const expiryMs = Date.parse(expiresAt);

  it('is fresh well before expiry', () => {
    const freshness = evaluateQuoteFreshness({ expiresAt }, expiryMs - 120_000);

    expect(freshness.isExpired).toBe(false);
    expect(freshness.isExpiringSoon).toBe(false);
    expect(freshness.secondsRemaining).toBe(120);
  });

  it('warns inside the final window', () => {
    const freshness = evaluateQuoteFreshness({ expiresAt }, expiryMs - QUOTE_EXPIRY_WARNING_MS + 1);
    expect(freshness.isExpired).toBe(false);
    expect(freshness.isExpiringSoon).toBe(true);
  });

  it('is expired exactly at the boundary', () => {
    expect(evaluateQuoteFreshness({ expiresAt }, expiryMs).isExpired).toBe(true);
  });

  it('is expired afterwards, and never reports negative time', () => {
    const freshness = evaluateQuoteFreshness({ expiresAt }, expiryMs + 60_000);
    expect(freshness.isExpired).toBe(true);
    expect(freshness.msRemaining).toBe(0);
    expect(freshness.secondsRemaining).toBe(0);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['unparseable', 'not-a-date'],
  ])('treats a %s expiry as expired rather than as valid forever', (_label, value) => {
    const freshness = evaluateQuoteFreshness({ expiresAt: value as string }, Date.now());
    expect(freshness.isExpired).toBe(true);
  });
});

// ── The signing gate ───────────────────────────────────────────────────────

describe('whether signing may proceed', () => {
  const fresh = evaluateQuoteFreshness(
    { expiresAt: '2026-08-25T12:05:00.000Z' },
    Date.parse('2026-08-25T12:00:00.000Z'),
  );
  const stale = evaluateQuoteFreshness(
    { expiresAt: '2026-08-25T12:05:00.000Z' },
    Date.parse('2026-08-25T12:06:00.000Z'),
  );

  it('allows a fresh quote with no discrepancies', () => {
    expect(canSignQuote(fresh, [])).toEqual({ allowed: true });
  });

  it('refuses an expired quote and says why', () => {
    const decision = canSignQuote(stale, []);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/expired/i);
  });

  it('refuses on a blocking discrepancy even when fresh', () => {
    const decision = canSignQuote(fresh, [
      {
        field: 'destinationAmount',
        expected: '25',
        actual: '250',
        severity: 'blocking',
        message: 'Amount mismatch',
      },
    ]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('Amount mismatch');
  });

  it('allows through a non-blocking warning', () => {
    const decision = canSignQuote(fresh, [
      {
        field: 'pathCount',
        expected: '1',
        actual: '2',
        severity: 'warning',
        message: 'Route changed',
      },
    ]);
    expect(decision.allowed).toBe(true);
  });
});
