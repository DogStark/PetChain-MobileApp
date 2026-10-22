import { StellarAnchorService } from '../stellarAnchorService';

const mockTomlNoAuth = `
TRANSFER_SERVER_SEP0024="https://testanchor.stellar.org/sep24"
`;

const mockTomlWithAuth = `
TRANSFER_SERVER_SEP0024="https://testanchor.stellar.org/sep24"
WEB_AUTH_ENDPOINT="https://testanchor.stellar.org/auth"
`;

function response<T>(ok: boolean, payload: T, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => (typeof payload === 'string' ? payload : ''),
  } as Response;
}

function installFetchMock(config: {
  toml: string;
  deposit?: { id: string; url: string };
  withdrawal?: { id: string; url: string };
  pollSequence?: Array<{
    status: number;
    transaction?: Record<string, unknown>;
    text?: string;
  }>;
  retryAuth?: boolean;
}) {
  const pollSequence = config.pollSequence ?? [
    {
      status: 200,
      transaction: {
        status: 'completed',
        amount_in: '100.00',
        amount_out: '99.50',
        stellar_transaction_id: 'stellar-tx-hash-abc',
      },
    },
  ];
  let pollIndex = 0;
  let authTokenIssued = false;

  return jest.fn().mockImplementation((input: string, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('stellar.toml')) {
      return Promise.resolve(response(true, config.toml));
    }

    if (url.includes('/auth') && (!init || init.method !== 'POST')) {
      return Promise.resolve(response(true, { transaction: 'challenge-xdr' }));
    }

    if (url.includes('/auth') && init?.method === 'POST') {
      authTokenIssued = true;
      return Promise.resolve(response(true, { token: 'jwt-token-abc' }));
    }

    if (url.includes('/transactions/deposit/interactive')) {
      return Promise.resolve(
        response(true, {
          id: config.deposit?.id ?? 'anchor-deposit-001',
          url: config.deposit?.url ?? 'https://testanchor.stellar.org/sep24/deposit',
          type: 'interactive_customer_info_needed',
        }),
      );
    }

    if (url.includes('/transactions/withdraw/interactive')) {
      return Promise.resolve(
        response(true, {
          id: config.withdrawal?.id ?? 'anchor-withdrawal-001',
          url: config.withdrawal?.url ?? 'https://testanchor.stellar.org/sep24/withdraw',
          type: 'interactive_customer_info_needed',
        }),
      );
    }

    if (url.includes('/transaction?id=')) {
      if (config.retryAuth && !authTokenIssued && pollIndex === 0) {
        pollIndex += 1;
        return Promise.resolve(response(false, 'Unauthorized', 401));
      }

      const item = pollSequence[Math.min(pollIndex, pollSequence.length - 1)];
      pollIndex += 1;
      return Promise.resolve(
        response(item.status >= 200 && item.status < 300, {
          transaction: item.transaction,
        }),
      );
    }

    return Promise.resolve(response(false, 'Not found', 404));
  });
}

describe('StellarAnchorService', () => {
  let service: StellarAnchorService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-23T10:00:00.000Z'));
    service = new StellarAnchorService(
      'testanchor.stellar.org',
      'SRT',
      'GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6',
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('initiateDeposit', () => {
    it('returns a depositId and interactiveUrl on success', async () => {
      global.fetch = installFetchMock({ toml: mockTomlNoAuth }) as typeof fetch;

      const result = await service.initiateDeposit('user-1', 'GABC123', 'USD');

      expect(result.depositId).toMatch(/^dep_/);
      expect(result.interactiveUrl).toContain('testanchor.stellar.org');
      expect(result.assetCode).toBe('SRT');
      expect(result.currency).toBe('USD');
    });

    it('stores the deposit record internally', async () => {
      global.fetch = installFetchMock({ toml: mockTomlNoAuth }) as typeof fetch;

      const { depositId } = await service.initiateDeposit('user-2', 'GXYZ', 'EUR');
      const deposits = service.getDepositsForUser('user-2');

      expect(deposits).toHaveLength(1);
      expect(deposits[0].id).toBe(depositId);
      expect(deposits[0].status).toBe('pending_user_transfer_start');
      expect(deposits[0].anchorTransactionId).toBe('anchor-deposit-001');
    });

    it('throws when the anchor does not support SEP-24', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(response(true, '# no transfer server')) as typeof fetch;

      await expect(service.initiateDeposit('user-3', 'GABC', 'USD')).rejects.toThrow(
        'does not support SEP-24',
      );
    });

    it('throws when the anchor deposit endpoint returns an error', async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes('stellar.toml')) {
          return Promise.resolve(response(true, mockTomlWithAuth));
        }
        if (url.includes('/auth') && !url.includes('POST')) {
          return Promise.resolve(response(true, { transaction: 'challenge-xdr' }));
        }
        if (url.includes('/auth') && url.includes('POST')) {
          return Promise.resolve(response(true, { token: 'jwt-token-abc' }));
        }
        return Promise.resolve(response(false, 'Unauthorized', 401));
      }) as typeof fetch;

      await expect(service.initiateDeposit('user-4', 'GABC', 'USD')).rejects.toThrow(
        'SEP-24 deposit initiation failed',
      );
    });
  });

  describe('initiateWithdrawal', () => {
    it('returns an interactive URL and stores a pending withdrawal transaction', async () => {
      global.fetch = installFetchMock({
        toml: mockTomlNoAuth,
        withdrawal: {
          id: 'anchor-withdrawal-123',
          url: 'https://testanchor.stellar.org/sep24/withdrawal?session=abc',
        },
      }) as typeof fetch;

      const result = await service.initiateWithdrawal('user-7', 'GABC', 'USD', '25.00');
      const records = service.getTransactionsForUser('user-7');

      expect(result.depositId).toMatch(/^dep_/);
      expect(result.interactiveUrl).toContain('/withdrawal?session=abc');
      expect(records).toHaveLength(1);
      expect(records[0].flowKind).toBe('withdrawal');
      expect(records[0].status).toBe('pending_anchor');
      expect(records[0].amount).toBe('25.00');
      expect(records[0].anchorTransactionId).toBe('anchor-withdrawal-123');
    });
  });

  describe('pollTransactionStatus', () => {
    it('transitions pending_anchor → completed and emits a balance refresh', async () => {
      global.fetch = installFetchMock({
        toml: mockTomlNoAuth,
        withdrawal: {
          id: 'anchor-withdrawal-200',
          url: 'https://testanchor.stellar.org/sep24/withdrawal?session=refresh',
        },
        pollSequence: [
          {
            status: 200,
            transaction: {
              status: 'completed',
              amount_in: '100.00',
              amount_out: '99.50',
              stellar_transaction_id: 'stellar-tx-hash-abc',
            },
          },
        ],
      }) as typeof fetch;

      const refreshHandler = jest.fn();
      service.on('balance:refresh', refreshHandler);

      const { depositId } = await service.initiateWithdrawal('user-8', 'GABC', 'USD', '25.00');
      const record = await service.pollTransactionStatus(depositId);

      expect(record.status).toBe('completed');
      expect(record.amountIn).toBe('100.00');
      expect(record.amountOut).toBe('99.50');
      expect(record.stellarTxId).toBe('stellar-tx-hash-abc');
      expect(refreshHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: depositId,
          flowKind: 'withdrawal',
          walletAddress: 'GABC',
          currency: 'USD',
        }),
      );
    });

    it('propagates error status with reason', async () => {
      global.fetch = installFetchMock({
        toml: mockTomlNoAuth,
        withdrawal: {
          id: 'anchor-withdrawal-300',
          url: 'https://testanchor.stellar.org/sep24/withdrawal?session=error',
        },
        pollSequence: [
          {
            status: 200,
            transaction: {
              status: 'error',
              reason: 'kyc_failed',
              message: 'KYC verification failed',
            },
          },
        ],
      }) as typeof fetch;

      const { depositId } = await service.initiateWithdrawal('user-9', 'GABC', 'USD', '10.00');
      const record = await service.pollTransactionStatus(depositId);

      expect(record.status).toBe('error');
      expect(record.reason).toBe('kyc_failed');
      expect(record.message).toBe('KYC verification failed');
    });

    it('triggers re-authentication when SEP-10 expires during polling', async () => {
      global.fetch = installFetchMock({
        toml: mockTomlNoAuth,
        withdrawal: {
          id: 'anchor-withdrawal-400',
          url: 'https://testanchor.stellar.org/sep24/withdrawal?session=reauth',
        },
        pollSequence: [
          {
            status: 200,
            transaction: {
              status: 'completed',
              amount_in: '50.00',
              amount_out: '49.50',
              stellar_transaction_id: 'stellar-tx-hash-reauthed',
            },
          },
        ],
        retryAuth: true,
      }) as typeof fetch;

      const reauthHandler = jest.fn();
      service.on('anchor:reauthenticate', reauthHandler);

      const { depositId } = await service.initiateWithdrawal('user-10', 'GABC', 'USD', '10.00');
      const pendingRecord = service.getTransactionsForUser('user-10')[0];
      pendingRecord.webAuthEndpoint = 'https://testanchor.stellar.org/auth';
      const record = await service.pollTransactionStatus(depositId);

      expect(reauthHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          anchorTxId: 'anchor-withdrawal-400',
          webAuthEndpoint: 'https://testanchor.stellar.org/auth',
        }),
      );
      expect(record.status).toBe('completed');
      expect(record.stellarTxId).toBe('stellar-tx-hash-reauthed');
      expect(
        (global.fetch as jest.Mock).mock.calls.some(([url]) => String(url).includes('/auth')),
      ).toBe(true);
    });

    it('emits anchor:timeout after 10 minutes of pending_external', async () => {
      global.fetch = installFetchMock({
        toml: mockTomlNoAuth,
        withdrawal: {
          id: 'anchor-withdrawal-500',
          url: 'https://testanchor.stellar.org/sep24/withdrawal?session=timeout',
        },
        pollSequence: [
          {
            status: 200,
            transaction: {
              status: 'pending_external',
              reason: 'awaiting_bank_transfer',
            },
          },
        ],
      }) as typeof fetch;

      const timeoutHandler = jest.fn();
      service.on('anchor:timeout', timeoutHandler);

      const { depositId } = await service.initiateWithdrawal('user-11', 'GABC', 'USD', '10.00');
      const record = service.getTransactionsForUser('user-11')[0];
      record.updatedAt = new Date('2026-06-23T09:49:59.999Z');

      const polled = await service.pollTransactionStatus(depositId);

      expect(polled.status).toBe('error');
      expect(polled.reason).toBe('awaiting_bank_transfer');
      expect(timeoutHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: depositId,
          flowKind: 'withdrawal',
          walletAddress: 'GABC',
          currency: 'USD',
        }),
      );
    });
  });

  describe('getDepositStatus', () => {
    it('polls the anchor and updates the record status', async () => {
      global.fetch = installFetchMock({ toml: mockTomlNoAuth }) as typeof fetch;

      const { depositId } = await service.initiateDeposit('user-5', 'GABC', 'USD');
      const record = await service.getDepositStatus(depositId);

      expect(record.status).toBe('completed');
      expect(record.amountIn).toBe('100.00');
      expect(record.amountOut).toBe('99.50');
      expect(record.stellarTxId).toBe('stellar-tx-hash-abc');
    });

    it('throws for an unknown depositId', async () => {
      await expect(service.getDepositStatus('nonexistent')).rejects.toThrow('not found');
    });

    it('returns cached state for terminal deposits without re-fetching', async () => {
      global.fetch = installFetchMock({ toml: mockTomlNoAuth }) as typeof fetch;

      const { depositId } = await service.initiateDeposit('user-6', 'GABC', 'USD');
      await service.getDepositStatus(depositId);

      const fetchCallCount = (global.fetch as jest.Mock).mock.calls.length;

      await service.getDepositStatus(depositId);
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchCallCount);
    });
  });

  describe('getDepositsForUser', () => {
    it('returns only deposits belonging to the given user', async () => {
      global.fetch = installFetchMock({ toml: mockTomlNoAuth }) as typeof fetch;

      await service.initiateDeposit('alice', 'GABC', 'USD');
      await service.initiateDeposit('alice', 'GABC', 'EUR');
      await service.initiateDeposit('bob', 'GXYZ', 'USD');

      expect(service.getDepositsForUser('alice')).toHaveLength(2);
      expect(service.getDepositsForUser('bob')).toHaveLength(1);
      expect(service.getDepositsForUser('charlie')).toHaveLength(0);
    });
  });
});
