/**
 * Tests for path-payment slippage & expiry protection (Issue #951).
 *
 * A quote can drift or expire between the moment the user reviews it and the
 * moment the signed transaction is submitted. These tests characterise the
 * binding that pins the reviewed quote's min-destination amount, deadline,
 * routing path, and both assets, and rejects any later quote that violates it.
 */

import {
  computeMinDestinationAmount,
  assertQuoteNotExpired,
  bindReviewedQuote,
  assertQuoteMatchesBinding,
  PathPaymentValidationError,
  DEFAULT_SLIPPAGE_BPS,
  type PathPaymentQuote,
} from '../stellarPathPaymentService';

const isoFromNow = (ms: number): string => new Date(Date.now() + ms).toISOString();

function makeQuote(overrides: Partial<PathPaymentQuote> = {}): PathPaymentQuote {
  return {
    paymentId: 'pay_1',
    plan: 'MONTHLY',
    userId: 'user_1',
    sourceAsset: { code: 'USDC', issuer: 'GISSUER1', type: 'credit_alphanum4' },
    destinationAsset: { code: 'XLM', type: 'native' },
    destinationAmount: '100.0000000',
    sourceAmount: '10.0000000',
    exchangeRate: '0.1',
    estimatedNetworkFee: '0.0000100',
    mode: 'path',
    path: [{ code: 'AQUA', issuer: 'GAQUA', type: 'credit_alphanum4' }],
    pathCount: 1,
    createdAt: isoFromNow(-60_000),
    expiresAt: isoFromNow(60_000),
    ...overrides,
  } as PathPaymentQuote;
}

describe('computeMinDestinationAmount', () => {
  it('applies the default 0.50% slippage tolerance', () => {
    expect(computeMinDestinationAmount('100')).toBe('99.5000000');
    expect(DEFAULT_SLIPPAGE_BPS).toBe(50);
  });

  it('applies an explicit tolerance in basis points', () => {
    expect(computeMinDestinationAmount('100', 100)).toBe('99.0000000');
    expect(computeMinDestinationAmount('100', 0)).toBe('100.0000000');
  });

  it('rejects an invalid destination amount', () => {
    expect(() => computeMinDestinationAmount('abc')).toThrow(PathPaymentValidationError);
    expect(() => computeMinDestinationAmount('-5')).toThrow(/Invalid destination amount/);
  });

  it('rejects an out-of-range or non-integer slippage', () => {
    expect(() => computeMinDestinationAmount('100', -1)).toThrow(/Slippage/);
    expect(() => computeMinDestinationAmount('100', 10_001)).toThrow(/Slippage/);
    expect(() => computeMinDestinationAmount('100', 12.5)).toThrow(/Slippage/);
  });
});

describe('assertQuoteNotExpired', () => {
  it('passes for a quote that is still valid', () => {
    expect(() => assertQuoteNotExpired(makeQuote())).not.toThrow();
  });

  it('throws QUOTE_EXPIRED once the deadline has passed', () => {
    const expired = makeQuote({ expiresAt: isoFromNow(-1_000) });
    try {
      assertQuoteNotExpired(expired);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as PathPaymentValidationError).code).toBe('QUOTE_EXPIRED');
    }
  });

  it('throws QUOTE_NO_EXPIRY for a missing / malformed timestamp', () => {
    const bad = makeQuote({ expiresAt: 'not-a-date' });
    expect(() => assertQuoteNotExpired(bad)).toThrow(/no valid expiry/);
  });
});

describe('bindReviewedQuote', () => {
  it('freezes the min amount and deadline from the reviewed quote', () => {
    const binding = bindReviewedQuote(makeQuote({ destinationAmount: '200.0000000' }), 50);
    expect(binding.minDestinationAmount).toBe('199.0000000');
    expect(binding.deadline).toBe(binding.deadline); // ISO string echoed through
    expect(binding.pathCount).toBe(1);
  });

  it('refuses to bind an already-expired quote', () => {
    expect(() => bindReviewedQuote(makeQuote({ expiresAt: isoFromNow(-5) }))).toThrow(
      PathPaymentValidationError,
    );
  });
});

describe('assertQuoteMatchesBinding', () => {
  it('passes when the fresh quote is identical to the reviewed one', () => {
    const reviewed = makeQuote();
    const binding = bindReviewedQuote(reviewed);
    expect(() => assertQuoteMatchesBinding(binding, makeQuote())).not.toThrow();
  });

  it('throws SLIPPAGE_EXCEEDED when the delivered amount drops below the floor', () => {
    const binding = bindReviewedQuote(makeQuote({ destinationAmount: '100.0000000' }), 50);
    const worse = makeQuote({ destinationAmount: '99.0000000' });
    try {
      assertQuoteMatchesBinding(binding, worse);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as PathPaymentValidationError).code).toBe('SLIPPAGE_EXCEEDED');
    }
  });

  it('throws ASSET_DRIFT when the destination asset changes', () => {
    const binding = bindReviewedQuote(makeQuote());
    const drift = makeQuote({
      destinationAsset: { code: 'USDC', type: 'native' } as PathPaymentQuote['destinationAsset'],
    });
    expect(() => assertQuoteMatchesBinding(binding, drift)).toThrow(/asset changed/);
  });

  it('throws PATH_DRIFT when the routing path or hop count changes', () => {
    const binding = bindReviewedQuote(makeQuote());
    const reroute = makeQuote({
      path: [{ code: 'yXLM', issuer: 'GYX', type: 'credit_alphanum4' }],
    });
    expect(() => assertQuoteMatchesBinding(binding, reroute)).toThrow(/path changed/);

    const extraHop = makeQuote({
      path: [
        { code: 'AQUA', issuer: 'GAQUA', type: 'credit_alphanum4' },
        { code: 'yXLM', issuer: 'GYX', type: 'credit_alphanum4' },
      ],
      pathCount: 2,
    });
    expect(() => assertQuoteMatchesBinding(binding, extraHop)).toThrow(/path changed/);
  });

  it('throws QUOTE_EXPIRED when the fresh quote has expired', () => {
    const binding = bindReviewedQuote(makeQuote());
    const stale = makeQuote({ expiresAt: isoFromNow(-1) });
    expect(() => assertQuoteMatchesBinding(binding, stale)).toThrow(/expired/);
  });
});
