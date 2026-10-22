/**
 * Consumer-driven contract tests for the Stellar SEP-24 anchor integration.
 * Uses a lightweight Pact-style mock provider instead of the full Pact library
 * to keep dependencies minimal. The "pact" (expected request/response shapes)
 * is defined inline and can be extracted to a JSON file for CI verification.
 *
 * Covers:
 *  - GET  /.well-known/stellar.toml  (SEP-1)
 *  - POST /sep24/transactions/deposit/interactive  (SEP-24 initiate deposit)
 *  - POST /sep24/transactions/withdraw/interactive (SEP-24 initiate withdrawal)
 *  - GET  /sep24/transaction?id=<id>              (SEP-24 poll status)
 *
 * #603
 */
import { StellarAnchorService } from '../stellarAnchorService';

// ─── Shared contract shapes ───────────────────────────────────────────────────

const TOML_RESPONSE = `
TRANSFER_SERVER_SEP0024="https://mock-anchor.example.com/sep24"
WEB_AUTH_ENDPOINT="https://mock-anchor.example.com/auth"
`;

const SEP24_INFO_RESPONSE = {
  deposit: {
    USDC: {
      enabled: true,
      fee_fixed: '0.00',
      min_amount: '10.00',
      max_amount: '10000.00',
    },
  },
  withdraw: {
    USDC: {
      enabled: true,
      fee_fixed: '0.00',
      min_amount: '10.00',
      max_amount: '10000.00',
    },
  },
};

const DEPOSIT_INTERACTIVE_RESPONSE = {
  id: 'anchor-tx-deposit-001',
  url: 'https://mock-anchor.example.com/sep24/interactive?token=abc',
  type: 'interactive_customer_info_needed',
};

const WITHDRAWAL_INTERACTIVE_RESPONSE = {
  id: 'anchor-tx-withdraw-001',
  url: 'https://mock-anchor.example.com/sep24/interactive?token=xyz',
  type: 'interactive_customer_info_needed',
};

const TRANSACTION_PENDING_RESPONSE = {
  transaction: {
    id: 'anchor-tx-deposit-001',
    kind: 'deposit',
    status: 'pending_user_transfer_start',
    amount_in: '',
    amount_out: '',
    message: 'Waiting for user to initiate transfer',
  },
};

const TRANSACTION_COMPLETE_RESPONSE = {
  transaction: {
    id: 'anchor-tx-deposit-001',
    kind: 'deposit',
    status: 'completed',
    amount_in: '100.00',
    amount_out: '99.50',
    stellar_transaction_id: 'stellar-hash-abc123',
    message: '',
  },
};

// ─── Mock provider fetch ──────────────────────────────────────────────────────

function buildMockFetch(overrides?: {
  pollResponse?: typeof TRANSACTION_PENDING_RESPONSE | typeof TRANSACTION_COMPLETE_RESPONSE;
  depositResponse?: typeof DEPOSIT_INTERACTIVE_RESPONSE;
}) {
  return jest.fn().mockImplementation((input: string, init?: RequestInit) => {
    const url = String(input);

    // SEP-1 TOML
    if (url.includes('stellar.toml')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => TOML_RESPONSE,
        json: async () => ({}),
      } as Response);
    }

    // SEP-10 challenge
    if (url.includes('/auth') && (!init || init.method !== 'POST')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ transaction: 'challenge-xdr' }),
        text: async () => '',
      } as Response);
    }

    // SEP-10 token
    if (url.includes('/auth') && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
        text: async () => '',
      } as Response);
    }

    // SEP-24 info
    if (url.includes('/sep24/info')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => SEP24_INFO_RESPONSE,
        text: async () => '',
      } as Response);
    }

    // SEP-24 deposit interactive
    if (url.includes('/deposit/interactive') && init?.method === 'POST') {
      const resp = overrides?.depositResponse ?? DEPOSIT_INTERACTIVE_RESPONSE;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => resp,
        text: async () => '',
      } as Response);
    }

    // SEP-24 withdrawal interactive
    if (url.includes('/withdraw/interactive') && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => WITHDRAWAL_INTERACTIVE_RESPONSE,
        text: async () => '',
      } as Response);
    }

    // SEP-24 transaction poll
    if (url.includes('/transaction?id=')) {
      const pollResp = overrides?.pollResponse ?? TRANSACTION_COMPLETE_RESPONSE;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => pollResp,
        text: async () => '',
      } as Response);
    }

    return Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'Not found',
    } as Response);
  });
}

// ─── Contract tests ───────────────────────────────────────────────────────────

describe('SEP-24 Anchor Contract Tests (#603)', () => {
  let service: StellarAnchorService;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    service = new StellarAnchorService(
      'mock-anchor.example.com',
      'USDC',
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    );
    mockFetch = buildMockFetch();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('SEP-1: stellar.toml', () => {
    it('response contains TRANSFER_SERVER_SEP0024', async () => {
      const result = await service.initiateDeposit('user-1', 'GADDR', 'USD');
      // If TRANSFER_SERVER_SEP0024 is missing, initiateDeposit throws — reaching here confirms it's present
      expect(result).toBeDefined();

      const tomlCall = mockFetch.mock.calls.find(([url]: [string]) =>
        String(url).includes('stellar.toml'),
      );
      expect(tomlCall).toBeDefined();
    });
  });

  describe('SEP-24 /transactions/deposit/interactive', () => {
    it('returns depositId, interactiveUrl, and assetCode', async () => {
      const result = await service.initiateDeposit('user-1', 'GADDR', 'USD');

      expect(result).toMatchObject({
        depositId: expect.any(String),
        interactiveUrl: DEPOSIT_INTERACTIVE_RESPONSE.url,
        assetCode: 'USDC',
        currency: 'USD',
      });
    });

    it('sends asset_code and account in the POST body', async () => {
      await service.initiateDeposit('user-1', 'GADDR_TEST', 'USD');

      const depositCall = mockFetch.mock.calls.find(([url, init]: [string, RequestInit]) => {
        return String(url).includes('/deposit/interactive') && init?.method === 'POST';
      });
      expect(depositCall).toBeDefined();
      const body = depositCall![1].body as string;
      expect(body).toContain('asset_code=USDC');
      expect(body).toContain('account=GADDR_TEST');
    });
  });

  describe('SEP-24 /transactions/withdraw/interactive', () => {
    it('returns depositId, interactiveUrl, and assetCode for withdrawal', async () => {
      const result = await service.initiateWithdrawal('user-1', 'GADDR', 'USD', '50.00');

      expect(result).toMatchObject({
        depositId: expect.any(String),
        interactiveUrl: WITHDRAWAL_INTERACTIVE_RESPONSE.url,
        assetCode: 'USDC',
        currency: 'USD',
      });
    });

    it('includes amount in the POST body for withdrawals', async () => {
      await service.initiateWithdrawal('user-1', 'GADDR', 'USD', '75.00');

      const withdrawCall = mockFetch.mock.calls.find(([url, init]: [string, RequestInit]) => {
        return String(url).includes('/withdraw/interactive') && init?.method === 'POST';
      });
      expect(withdrawCall).toBeDefined();
      const body = withdrawCall![1].body as string;
      expect(body).toContain('amount=75.00');
    });
  });

  describe('SEP-24 /transaction poll status', () => {
    it('returns completed status with amount_in and amount_out', async () => {
      const { depositId } = await service.initiateDeposit('user-1', 'GADDR', 'USD');
      const record = await service.pollTransactionStatus(depositId);

      expect(record.status).toBe('completed');
      expect(record.amountIn).toBe('100.00');
      expect(record.amountOut).toBe('99.50');
      expect(record.stellarTxId).toBe('stellar-hash-abc123');
    });

    it('returns pending status without failing', async () => {
      const pendingMockFetch = buildMockFetch({ pollResponse: TRANSACTION_PENDING_RESPONSE });
      global.fetch = pendingMockFetch;

      const { depositId } = await service.initiateDeposit('user-1', 'GADDR', 'USD');
      const record = await service.pollTransactionStatus(depositId);

      expect(record.status).toBe('pending_user_transfer_start');
    });

    it('returns cached state for terminal status without re-polling', async () => {
      const { depositId } = await service.initiateDeposit('user-1', 'GADDR', 'USD');
      await service.pollTransactionStatus(depositId); // first poll → completed

      const callsBefore = mockFetch.mock.calls.length;
      await service.pollTransactionStatus(depositId); // second poll → should use cache
      const callsAfter = mockFetch.mock.calls.length;

      // No additional fetch calls for a terminal status
      expect(callsAfter).toBe(callsBefore);
    });
  });

  describe('SEP-24 /info response shape', () => {
    it('anchor info contains deposit and withdraw for USDC', () => {
      // Validate the contract shape we rely on
      expect(SEP24_INFO_RESPONSE.deposit).toHaveProperty('USDC');
      expect(SEP24_INFO_RESPONSE.withdraw).toHaveProperty('USDC');
      expect(SEP24_INFO_RESPONSE.deposit.USDC).toMatchObject({
        enabled: expect.any(Boolean),
        fee_fixed: expect.any(String),
        min_amount: expect.any(String),
        max_amount: expect.any(String),
      });
    });
  });
});
