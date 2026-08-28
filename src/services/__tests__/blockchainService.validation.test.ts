/**
 * Tests for Stellar destination / memo validation (Issue #948) and stale
 * sequence-number protection (Issue #949) in blockchainService.
 *
 * These characterise the guards that run *before* a payment transaction is
 * built and submitted:
 *  - malformed / missing destination addresses are rejected up front
 *  - SEP-0029 `config.memo_required` accounts cannot be paid without a memo
 *  - Horizon `tx_bad_seq` rejections are recognised so callers can rebuild
 *
 * The real @stellar/stellar-sdk is used (no jest.mock) so StrKey validation is
 * exercised for real; the account lookup is injected as a fake.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

import {
  validateStellarDestination,
  destinationRequiresMemo,
  assertDestinationAndMemo,
  isBadSequenceError,
  BlockchainServiceError,
} from '../blockchainService';

describe('validateStellarDestination (Issue #948)', () => {
  it('accepts and normalizes a valid ed25519 public key', () => {
    const pk = StellarSdk.Keypair.random().publicKey();
    const result = validateStellarDestination(`  ${pk}  `);
    expect(result.type).toBe('ed25519');
    expect(result.normalized).toBe(pk);
  });

  it('rejects an empty address with INVALID_DESTINATION', () => {
    expect(() => validateStellarDestination('')).toThrow(BlockchainServiceError);
    try {
      validateStellarDestination('   ');
    } catch (err) {
      expect((err as BlockchainServiceError).code).toBe('INVALID_DESTINATION');
    }
  });

  it('rejects a malformed address with INVALID_DESTINATION', () => {
    try {
      validateStellarDestination('GNOTAREALKEY');
      throw new Error('expected validateStellarDestination to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BlockchainServiceError);
      expect((err as BlockchainServiceError).code).toBe('INVALID_DESTINATION');
    }
  });
});

describe('destinationRequiresMemo (SEP-0029)', () => {
  const pk = StellarSdk.Keypair.random().publicKey();

  it('returns true when the account publishes config.memo_required', async () => {
    const loader = jest.fn().mockResolvedValue({ data_attr: { 'config.memo_required': 'MQ==' } });
    await expect(destinationRequiresMemo(pk, loader)).resolves.toBe(true);
  });

  it('returns false when no memo flag is present', async () => {
    const loader = jest.fn().mockResolvedValue({ data_attr: {} });
    await expect(destinationRequiresMemo(pk, loader)).resolves.toBe(false);
  });

  it('returns false for an unfunded / unknown account', async () => {
    const loader = jest
      .fn()
      .mockRejectedValue(new BlockchainServiceError('missing', 'ACCOUNT_NOT_FOUND'));
    await expect(destinationRequiresMemo(pk, loader)).resolves.toBe(false);
  });

  it('propagates unexpected lookup failures (offline / timeout)', async () => {
    const loader = jest.fn().mockRejectedValue(new Error('network down'));
    await expect(destinationRequiresMemo(pk, loader)).rejects.toThrow('network down');
  });
});

describe('assertDestinationAndMemo (Issue #948)', () => {
  const pk = StellarSdk.Keypair.random().publicKey();
  const memoRequired = () =>
    jest.fn().mockResolvedValue({ data_attr: { 'config.memo_required': '1' } });

  it('throws MEMO_REQUIRED when a memo is missing but required', async () => {
    await expect(assertDestinationAndMemo(pk, undefined, memoRequired())).rejects.toMatchObject({
      code: 'MEMO_REQUIRED',
    });
  });

  it('throws MEMO_REQUIRED when the memo is blank', async () => {
    await expect(assertDestinationAndMemo(pk, '   ', memoRequired())).rejects.toMatchObject({
      code: 'MEMO_REQUIRED',
    });
  });

  it('passes when a memo is supplied', async () => {
    await expect(
      assertDestinationAndMemo(pk, 'deposit-123', memoRequired()),
    ).resolves.toBeUndefined();
  });

  it('passes when no memo is required', async () => {
    const loader = jest.fn().mockResolvedValue({ data_attr: {} });
    await expect(assertDestinationAndMemo(pk, undefined, loader)).resolves.toBeUndefined();
  });

  it('rejects an invalid destination before any account lookup', async () => {
    const loader = jest.fn();
    await expect(assertDestinationAndMemo('bogus', 'memo', loader)).rejects.toMatchObject({
      code: 'INVALID_DESTINATION',
    });
    expect(loader).not.toHaveBeenCalled();
  });
});

describe('isBadSequenceError (Issue #949)', () => {
  it('detects Horizon result_codes.transaction === tx_bad_seq', () => {
    expect(
      isBadSequenceError({
        response: { data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } },
      }),
    ).toBe(true);
  });

  it('detects a wrapped BlockchainServiceError mentioning tx_bad_seq', () => {
    expect(
      isBadSequenceError(
        new BlockchainServiceError('Transaction failed: tx_bad_seq', 'TRANSACTION_FAILED'),
      ),
    ).toBe(true);
  });

  it('detects error.code === txBadSeq', () => {
    expect(isBadSequenceError({ code: 'txBadSeq' })).toBe(true);
  });

  it('is false for unrelated errors and nullish input', () => {
    expect(isBadSequenceError(new Error('request timeout'))).toBe(false);
    expect(isBadSequenceError(null)).toBe(false);
    expect(isBadSequenceError(undefined)).toBe(false);
    expect(
      isBadSequenceError({
        response: { data: { extras: { result_codes: { transaction: 'tx_insufficient_fee' } } } },
      }),
    ).toBe(false);
  });
});
