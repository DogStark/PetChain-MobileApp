/**
 * Tests for trustline reserve & liability checks (Issue #950).
 *
 * Creating a trustline locks an extra 0.5 XLM reserve; removing one that still
 * holds a balance — or that is referenced by open offers (buying/selling
 * liabilities) — strands funds. These tests characterise the helpers that
 * explain the reserve impact and block unsafe removals at the exact limits.
 */

import {
  describeReserveImpact,
  canAffordNewTrustline,
  assertTrustlineRemovable,
  XLM_RESERVE_PER_TRUSTLINE,
  TrustlineError,
} from '../trustlineService';
import type { TrustlineState } from '../../models/Trustline';

function makeState(overrides: Partial<TrustlineState> = {}): TrustlineState {
  return {
    accountPublicKey: 'GABC',
    xlmBalance: '10.0000000',
    xlmReservePerTrustline: XLM_RESERVE_PER_TRUSTLINE,
    trustlines: [],
    totalReservedXlm: 2,
    availableXlm: '8.0000000',
    ...overrides,
  };
}

describe('describeReserveImpact — add', () => {
  it('reports the +0.5 XLM reserve delta and remaining balance', () => {
    const impact = describeReserveImpact(makeState(), 'add');
    expect(impact.reserveDeltaXlm).toBe(0.5);
    expect(impact.projectedReservedXlm).toBe(2.5);
    expect(impact.projectedAvailableXlm).toBe('7.5000000');
    expect(impact.sufficient).toBe(true);
    expect(impact.summary).toMatch(/locks an extra 0\.5 XLM/);
  });

  it('flags an account that cannot cover the new reserve at the limit', () => {
    const broke = makeState({ xlmBalance: '2.4000000', totalReservedXlm: 2 });
    const impact = describeReserveImpact(broke, 'add');
    expect(impact.sufficient).toBe(false);
    expect(impact.summary).toMatch(/short/);
    expect(canAffordNewTrustline(broke)).toBe(false);
  });

  it('treats exactly enough XLM as sufficient (boundary)', () => {
    const exact = makeState({ xlmBalance: '2.5000000', totalReservedXlm: 2 });
    expect(canAffordNewTrustline(exact)).toBe(true);
    expect(describeReserveImpact(exact, 'add').projectedAvailableXlm).toBe('0.0000000');
  });
});

describe('describeReserveImpact — remove', () => {
  it('reports the -0.5 XLM reserve delta as always sufficient', () => {
    const impact = describeReserveImpact(makeState(), 'remove');
    expect(impact.reserveDeltaXlm).toBe(-0.5);
    expect(impact.projectedReservedXlm).toBe(1.5);
    expect(impact.sufficient).toBe(true);
    expect(impact.summary).toMatch(/frees 0\.5 XLM/);
  });

  it('never reports a negative projected reserve', () => {
    const impact = describeReserveImpact(makeState({ totalReservedXlm: 0 }), 'remove');
    expect(impact.projectedReservedXlm).toBe(0);
  });
});

describe('assertTrustlineRemovable', () => {
  it('allows removal at a zero balance with no liabilities', () => {
    expect(() =>
      assertTrustlineRemovable({
        assetCode: 'PETC',
        balance: '0.0000000',
        selling_liabilities: '0.0000000',
        buying_liabilities: '0.0000000',
      }),
    ).not.toThrow();
  });

  it('blocks removal with NON_ZERO_BALANCE when a balance remains', () => {
    try {
      assertTrustlineRemovable({ assetCode: 'PETC', balance: '5.0000000' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TrustlineError);
      expect((err as TrustlineError).code).toBe('NON_ZERO_BALANCE');
    }
  });

  it('blocks removal with HAS_LIABILITIES for open sell offers', () => {
    try {
      assertTrustlineRemovable({
        assetCode: 'PETC',
        balance: '0.0000000',
        selling_liabilities: '1.0000000',
      });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as TrustlineError).code).toBe('HAS_LIABILITIES');
    }
  });

  it('blocks removal for open buy offers, accepting camelCase fields', () => {
    try {
      assertTrustlineRemovable({
        assetCode: 'PETC',
        balance: '0.0000000',
        buyingLiabilities: '2.0000000',
      });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as TrustlineError).code).toBe('HAS_LIABILITIES');
    }
  });
});
