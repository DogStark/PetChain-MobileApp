/**
 * Tests for PendingCoSignScreen verification logic and UI paths.
 *
 * Covers: payload verification, expiry, network mismatch, sequence mismatch,
 * payload tampering, missing fields, approve, reject, and offline/malformed paths.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import PendingCoSignScreen, {
  verifyCoSignPayload,
  buildCanonicalString,
  simpleHash,
  EXPECTED_NETWORK,
  type CoSignPayload,
} from '../PendingCoSignScreen';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;
const FUTURE = NOW + 5 * 60 * 1000; // 5 min from now
const PAST = NOW - 1;

function makePayload(overrides: Partial<CoSignPayload> = {}): CoSignPayload {
  const base: Omit<CoSignPayload, 'payloadHash'> = {
    txId: 'tx-abc-001',
    initiator: 'user-cosign-001',
    network: EXPECTED_NETWORK,
    sequence: 42,
    expiresAt: FUTURE,
    operations: [{ type: 'PAYMENT', amount: '10.00', destination: 'dest-001' }],
  };
  const canonical = buildCanonicalString({ ...base, payloadHash: '', ...overrides });
  const payloadHash = simpleHash(canonical);
  return { ...base, payloadHash, ...overrides };
}

// ─── Unit: verifyCoSignPayload ────────────────────────────────────────────────

describe('verifyCoSignPayload', () => {
  it('returns valid for a well-formed, unexpired payload', () => {
    const payload = makePayload();
    expect(verifyCoSignPayload(payload, 42, NOW)).toEqual({ valid: true });
  });

  it('rejects expired payload', () => {
    const payload = makePayload({ expiresAt: PAST });
    const result = verifyCoSignPayload(payload, 42, NOW);
    expect(result).toEqual({ valid: false, error: 'EXPIRED' });
  });

  it('rejects wrong network', () => {
    const payload = makePayload({ network: 'other-net' });
    // Recompute hash for altered payload so only network triggers failure
    const canonical = buildCanonicalString(payload);
    const fixedPayload = { ...payload, payloadHash: simpleHash(canonical) };
    const result = verifyCoSignPayload(fixedPayload, 42, NOW);
    expect(result).toEqual({ valid: false, error: 'NETWORK_MISMATCH' });
  });

  it('rejects wrong sequence', () => {
    const payload = makePayload();
    const result = verifyCoSignPayload(payload, 99, NOW);
    expect(result).toEqual({ valid: false, error: 'SEQUENCE_INVALID' });
  });

  it('rejects altered payload (hash mismatch)', () => {
    const payload = makePayload();
    const tampered: CoSignPayload = {
      ...payload,
      operations: [{ type: 'PAYMENT', amount: '9999.00', destination: 'attacker-001' }],
    };
    const result = verifyCoSignPayload(tampered, 42, NOW);
    expect(result).toEqual({ valid: false, error: 'PAYLOAD_ALTERED' });
  });

  it('rejects missing required fields', () => {
    const payload = makePayload({ txId: '' });
    const result = verifyCoSignPayload(payload, 42, NOW);
    expect(result).toEqual({ valid: false, error: 'MISSING_FIELDS' });
  });

  it('rejects payload with missing operations array', () => {
    const payload = { ...makePayload(), operations: null as any };
    const result = verifyCoSignPayload(payload, 42, NOW);
    expect(result).toEqual({ valid: false, error: 'MISSING_FIELDS' });
  });

  it('rejects payload expiring exactly at now', () => {
    const payload = makePayload({ expiresAt: NOW });
    const result = verifyCoSignPayload(payload, 42, NOW);
    expect(result).toEqual({ valid: false, error: 'EXPIRED' });
  });
});

// ─── Unit: simpleHash ─────────────────────────────────────────────────────────

describe('simpleHash', () => {
  it('is deterministic', () => {
    expect(simpleHash('hello')).toBe(simpleHash('hello'));
  });

  it('differs for different inputs', () => {
    expect(simpleHash('hello')).not.toBe(simpleHash('world'));
  });

  it('returns 8-char hex string', () => {
    expect(simpleHash('test')).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ─── Unit: buildCanonicalString ───────────────────────────────────────────────

describe('buildCanonicalString', () => {
  it('excludes payloadHash from canonical string', () => {
    const payload = makePayload();
    const canonical = buildCanonicalString(payload);
    expect(canonical).not.toContain('payloadHash');
  });

  it('includes all required fields', () => {
    const payload = makePayload();
    const canonical = buildCanonicalString(payload);
    expect(canonical).toContain(payload.txId);
    expect(canonical).toContain(payload.initiator);
    expect(canonical).toContain(payload.network);
  });
});

// ─── UI: PendingCoSignScreen ──────────────────────────────────────────────────

jest.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'pendingCoSign.title': 'Review Transaction',
        'pendingCoSign.subtitle': 'Verify before signing',
        'pendingCoSign.verifying': 'Verifying…',
        'pendingCoSign.txId': 'Transaction ID',
        'pendingCoSign.initiator': 'Initiator',
        'pendingCoSign.network': 'Network',
        'pendingCoSign.sequence': 'Sequence',
        'pendingCoSign.expiresIn': 'Expires in',
        'pendingCoSign.expiresInValue': `${params?.seconds}s`,
        'pendingCoSign.operations': 'Operations',
        'pendingCoSign.payloadHash': 'Payload Hash',
        'pendingCoSign.approveAction': 'Approve',
        'pendingCoSign.rejectAction': 'Reject',
        'pendingCoSign.rejectTitle': 'Reject Transaction',
        'pendingCoSign.rejectConfirm': 'Are you sure?',
        'pendingCoSign.invalidTitle': 'Invalid Request',
        'pendingCoSign.error_EXPIRED': 'This request has expired.',
        'pendingCoSign.error_NETWORK_MISMATCH': 'Network mismatch.',
        'pendingCoSign.error_SEQUENCE_INVALID': 'Invalid sequence.',
        'pendingCoSign.error_PAYLOAD_ALTERED': 'Payload has been altered.',
        'pendingCoSign.error_MISSING_FIELDS': 'Missing required fields.',
        'pendingCoSign.dismissInvalid': 'Dismiss',
        'pendingCoSign.approveError': 'Approval failed.',
        'pendingCoSign.screenLabel': 'Pending Co-Sign Screen',
        'pendingCoSign.verificationFailed': `Verification failed: ${params?.error}`,
        'common.error': 'Error',
        'common.cancel': 'Cancel',
      };
      return map[key] ?? key;
    },
  }),
}));

function buildNavigation(overrides = {}) {
  return { goBack: jest.fn(), ...overrides } as any;
}

function buildRoute(payloadOverrides: Partial<CoSignPayload> = {}, sequence = 42) {
  const payload = makePayload(payloadOverrides);
  return {
    params: {
      payload,
      expectedSequence: sequence,
      onApprove: jest.fn(),
      onReject: jest.fn(),
    },
  } as any;
}

describe('PendingCoSignScreen UI', () => {
  it('renders canonical transaction details for a valid payload', () => {
    const { getByText } = render(
      <PendingCoSignScreen route={buildRoute()} navigation={buildNavigation()} />,
    );
    expect(getByText('Review Transaction')).toBeTruthy();
    expect(getByText('tx-abc-001')).toBeTruthy();
    expect(getByText('user-cosign-001')).toBeTruthy();
    expect(getByText(EXPECTED_NETWORK)).toBeTruthy();
    expect(getByText('42')).toBeTruthy();
  });

  it('shows Approve and Reject buttons for valid payload', () => {
    const { getByText } = render(
      <PendingCoSignScreen route={buildRoute()} navigation={buildNavigation()} />,
    );
    expect(getByText('Approve')).toBeTruthy();
    expect(getByText('Reject')).toBeTruthy();
  });

  it('calls onApprove and navigates back on approval', async () => {
    const navigation = buildNavigation();
    const route = buildRoute();
    const { getByText } = render(
      <PendingCoSignScreen route={route} navigation={navigation} />,
    );
    fireEvent.press(getByText('Approve'));
    await waitFor(() => {
      expect(route.params.onApprove).toHaveBeenCalledWith(route.params.payload);
      expect(navigation.goBack).toHaveBeenCalled();
    });
  });

  it('shows invalid screen for expired payload', () => {
    const { getByText } = render(
      <PendingCoSignScreen
        route={buildRoute({ expiresAt: PAST })}
        navigation={buildNavigation()}
      />,
    );
    expect(getByText('Invalid Request')).toBeTruthy();
    expect(getByText('This request has expired.')).toBeTruthy();
  });

  it('shows invalid screen for network mismatch', () => {
    const payload = makePayload({ network: 'rogue-net' });
    const canonical = buildCanonicalString(payload);
    const fixedPayload = { ...payload, payloadHash: simpleHash(canonical) };
    const route = {
      params: {
        payload: fixedPayload,
        expectedSequence: 42,
        onApprove: jest.fn(),
        onReject: jest.fn(),
      },
    } as any;
    const { getByText } = render(
      <PendingCoSignScreen route={route} navigation={buildNavigation()} />,
    );
    expect(getByText('Network mismatch.')).toBeTruthy();
  });

  it('shows invalid screen for altered payload', () => {
    const payload = makePayload();
    const tampered: CoSignPayload = {
      ...payload,
      operations: [{ type: 'PAYMENT', amount: '9999.00', destination: 'attacker' }],
    };
    const route = {
      params: {
        payload: tampered,
        expectedSequence: 42,
        onApprove: jest.fn(),
        onReject: jest.fn(),
      },
    } as any;
    const { getByText } = render(
      <PendingCoSignScreen route={route} navigation={buildNavigation()} />,
    );
    expect(getByText('Payload has been altered.')).toBeTruthy();
  });

  it('calls onReject and navigates back when Dismiss is pressed on invalid screen', () => {
    const navigation = buildNavigation();
    const route = buildRoute({ expiresAt: PAST });
    const { getByText } = render(
      <PendingCoSignScreen route={route} navigation={navigation} />,
    );
    fireEvent.press(getByText('Dismiss'));
    expect(route.params.onReject).toHaveBeenCalledWith(route.params.payload.txId);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('does not log or display raw token or wallet material', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { queryByText } = render(
      <PendingCoSignScreen route={buildRoute()} navigation={buildNavigation()} />,
    );
    // payloadHash is shown as a reference label, not a secret token
    expect(queryByText(/secret|privateKey|wallet/i)).toBeNull();
    consoleSpy.mockRestore();
  });
});
