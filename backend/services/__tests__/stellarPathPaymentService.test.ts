jest.mock('@stellar/stellar-sdk', () => {
  function MockAsset(code?: string, issuer?: string) {
    if (!(this instanceof MockAsset)) {
      return new (MockAsset as any)(code, issuer);
    }
    this.code = code;
    this.issuer = issuer;
    this.native = false;
    this.isNative = () => false;
  }

  MockAsset.native = () => {
    return { code: 'XLM', native: true, isNative: () => true };
  };

  function MockTransaction(xdr: string, networkPassphrase: string) {
    if (!(this instanceof MockTransaction)) {
      return new (MockTransaction as any)(xdr, networkPassphrase);
    }
    this.xdr = xdr;
    this.networkPassphrase = networkPassphrase;
    this.sign = jest.fn();
    this.toXDR = jest.fn(() => this.xdr);
  }

  function MockTransactionBuilder(account: unknown, options: unknown) {
    if (!(this instanceof MockTransactionBuilder)) {
      return new (MockTransactionBuilder as any)(account, options);
    }
    this.account = account;
    this.options = options;
    this.operations = [];
    this.memoValue = null;
    this.timeoutValue = null;
  }

  MockTransactionBuilder.prototype.addOperation = function addOperation(operation: unknown) {
    this.operations.push(operation);
    return this;
  };
  MockTransactionBuilder.prototype.addMemo = function addMemo(memo: unknown) {
    this.memoValue = memo;
    return this;
  };
  MockTransactionBuilder.prototype.setTimeout = function setTimeout(timeout: unknown) {
    this.timeoutValue = timeout;
    return this;
  };
  MockTransactionBuilder.prototype.build = function build() {
    return new MockTransaction(
      JSON.stringify({
        account: this.account,
        options: this.options,
        operations: this.operations,
        memo: this.memoValue,
        timeout: this.timeoutValue,
      }),
      'TESTNET',
    );
  };

  function MockKeypair(publicKey: string) {
    if (!(this instanceof MockKeypair)) {
      return new (MockKeypair as any)(publicKey);
    }
    this.publicKey = () => publicKey;
  }
  MockKeypair.fromSecret = (secret: string) => {
    return { publicKey: () => 'GDESTINATION000000000000000000000000000000000000000' };
  };

  return {
    Asset: MockAsset,
    Keypair: MockKeypair,
    TransactionBuilder: MockTransactionBuilder,
    Transaction: MockTransaction,
    Networks: { TESTNET: 'TESTNET', PUBLIC: 'PUBLIC' },
    Operation: {
      payment: jest.fn((params) => ({ kind: 'payment', params })),
      pathPaymentStrictSend: jest.fn((params) => ({ kind: 'strict-send', params })),
    },
    Memo: { text: jest.fn((value) => ({ kind: 'text', value })) },
    Horizon: { Server: jest.fn() },
  };
});

import { UserRole } from '../../models/UserRole';
import { store } from '../../server/store';
import stellarPathPaymentService, {
  PathPaymentPathNotFoundError,
  StellarPathPaymentService,
} from '../stellarPathPaymentService';

function buildServer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    strictReceivePaths: jest.fn(),
    strictSendPaths: jest.fn(),
    loadAccount: jest.fn(),
    fetchBaseFee: jest.fn().mockResolvedValue(100),
    submitTransaction: jest.fn(),
    ...overrides,
  } as unknown as ConstructorParameters<typeof StellarPathPaymentService>[0];
}

const SOURCE_ACCOUNT = 'GSOURCEACCOUNT0000000000000000000000000000000000000000';
const SOURCE_SECRET = 'SSOURCESECRET0000000000000000000000000000000000000000';
const SOURCE_ISSUER = 'GISSUER0000000000000000000000000000000000000000000000';
const DESTINATION_ACCOUNT = 'GDESTINATION000000000000000000000000000000000000000';
const PATH_ISSUER = 'GPATHISSUER00000000000000000000000000000000000000000';

function makePathRecord(sourceAmount: string, pathLength = 1) {
  return {
    path: Array.from({ length: pathLength }, (_, index) => ({
      asset_code: `USDC${index}`.slice(0, 4),
      asset_issuer: PATH_ISSUER,
      asset_type: 'credit_alphanum4',
    })),
    source_amount: sourceAmount,
    source_asset_type: 'credit_alphanum4',
    source_asset_code: 'USDC',
    source_asset_issuer: PATH_ISSUER,
    destination_amount: '9.9900000',
    destination_asset_type: 'native',
    destination_asset_code: 'XLM',
    destination_asset_issuer: '',
  };
}

describe('stellarPathPaymentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STELLAR_RECEIVING_SECRET = SOURCE_SECRET;
    process.env.STELLAR_RECEIVING_PUBLIC_KEY = DESTINATION_ACCOUNT;
    process.env.STELLAR_PATH_FEE_STROOPS = '100';
    store.users.clear();
    store.users.set('user-1', {
      id: 'user-1',
      email: 'buyer@test.com',
      name: 'Buyer',
      role: UserRole.OWNER,
      pets: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEmailVerified: true,
      twoFactorEnabled: false,
    });
  });

  it('findPaymentPath returns a typed error when no path is found', async () => {
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({ records: [] }),
    });
    const service = new StellarPathPaymentService(server);

    await expect(
      service.findPaymentPath({
        sourceAsset: { isNative: () => true } as any,
        destinationAsset: { isNative: () => true } as any,
        destinationAmount: '9.99',
      }),
    ).rejects.toBeInstanceOf(PathPaymentPathNotFoundError);
  });

  it('findPaymentPath ranks multiple paths by lowest source fee', async () => {
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [makePathRecord('12.5000000', 1), makePathRecord('11.1000000', 2)],
      }),
    });
    const service = new StellarPathPaymentService(server);

    const best = await service.findPaymentPath({
      sourceAsset: { isNative: () => false, code: 'USDC', issuer: SOURCE_ISSUER } as any,
      destinationAsset: { isNative: () => true } as any,
      destinationAmount: '9.99',
    });

    expect(best.source_amount).toBe('11.1000000');
  });

  it('assetFromInput accepts native XLM and rejects missing issuer for custom assets', async () => {
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({ records: [makePathRecord('12.5000000', 1)] }),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });
    const service = new StellarPathPaymentService(server);

    const nativePrepared = await service.preparePayment({
      userId: 'user-1',
      plan: 'premium_monthly',
      sourceAsset: { code: 'XLM' },
      sourceAccount: SOURCE_ACCOUNT,
    });
    expect(nativePrepared.quote.sourceAsset).toEqual({ code: 'XLM', type: 'native' });

    await expect(
      service.preparePayment({
        userId: 'user-1',
        plan: 'premium_monthly',
        sourceAsset: { code: 'USDC' },
        sourceAccount: SOURCE_ACCOUNT,
      }),
    ).rejects.toThrow('Asset issuer is required for non-native Stellar assets');
  });

  it('builds a strict-send transaction using the minimum destination amount and fee floor', async () => {
    const server = buildServer({ fetchBaseFee: jest.fn().mockResolvedValue(50) });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });

    const service = new StellarPathPaymentService(server);
    const xdr = await service.executePathPayment({
      sourceAccount: SOURCE_ACCOUNT,
      paymentId: 'payment-123',
      quote: {
        paymentId: 'payment-123',
        plan: 'premium_monthly',
        userId: 'user-1',
        sourceAsset: {
          code: 'USDC',
          issuer: SOURCE_ISSUER,
          type: 'credit_alphanum4',
        },
        destinationAsset: { code: 'XLM', type: 'native' },
        destinationAmount: '9.9900000',
        sourceAmount: '12.5000000',
        exchangeRate: '1.2512513',
        estimatedNetworkFee: '0.0000100',
        mode: 'path',
        path: [
          {
            code: 'USDC',
            issuer: SOURCE_ISSUER,
            type: 'credit_alphanum4',
          },
        ],
        pathCount: 1,
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      },
    });

    const payload = JSON.parse(xdr);
    expect(payload.options.fee).toBe('100');
    expect(payload.operations[0].kind).toBe('strict-send');
    expect(payload.operations[0].params.destMin).toBe('9.9400500');
  });

  it('builds a direct XLM transaction when falling back to the payment operation', async () => {
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({ records: [] }),
    });
    (server.strictSendPaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({ records: [makePathRecord('9.5000000', 0)] }),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });

    const service = new StellarPathPaymentService(server);
    const prepared = await service.preparePayment({
      userId: 'user-1',
      plan: 'premium_monthly',
      sourceAsset: {
        code: 'USDC',
        issuer: SOURCE_ISSUER,
      },
      sourceAccount: SOURCE_ACCOUNT,
    });

    expect(prepared.quote.mode).toBe('direct-xlm');
    expect(prepared.transactionXdr).toContain('"kind":"payment"');
  });

  it('builds a strict-send transaction with native path steps and annual pricing', async () => {
    const server = buildServer({ fetchBaseFee: jest.fn().mockResolvedValue(200) });
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [
          {
            ...makePathRecord('95.8800000', 1),
            path: [
              {
                asset_code: 'XLM',
                asset_issuer: '',
                asset_type: 'native',
              },
            ],
          },
        ],
      }),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });

    const service = new StellarPathPaymentService(server);
    const prepared = await service.preparePayment({
      userId: 'user-1',
      plan: 'premium_annual',
      sourceAsset: {
        code: 'USDC',
        issuer: SOURCE_ISSUER,
      },
      sourceAccount: SOURCE_ACCOUNT,
    });

    expect(prepared.quote.destinationAmount).toBe('95.88');
    expect(prepared.quote.path[0].type).toBe('native');

    const payload = JSON.parse(prepared.transactionXdr);
    expect(payload.operations[0].kind).toBe('strict-send');
    expect(payload.operations[0].params.path[0].native).toBe(true);
  });

  it('falls back to direct XLM payment when no path is found and records the fallback reason', async () => {
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({ records: [] }),
    });
    (server.strictSendPaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({ records: [makePathRecord('9.9900000', 0)] }),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });

    const service = new StellarPathPaymentService(server);
    const prepared = await service.preparePayment({
      userId: 'user-1',
      plan: 'premium_monthly',
      sourceAsset: {
        code: 'USDC',
        issuer: SOURCE_ISSUER,
      },
      sourceAccount: SOURCE_ACCOUNT,
    });

    expect(prepared.quote.mode).toBe('direct-xlm');
    expect(prepared.quote.fallbackReason).toBe('No conversion path found via DEX');
  });

  it('surfaces op_no_destination style errors from submitTransaction', async () => {
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [makePathRecord('12.5000000', 1)],
      }),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });
    (server.submitTransaction as jest.Mock).mockRejectedValue(new Error('op_no_destination'));

    const service = new StellarPathPaymentService(server);
    const prepared = await service.preparePayment({
      userId: 'user-1',
      plan: 'premium_monthly',
      sourceAsset: {
        code: 'USDC',
        issuer: SOURCE_ISSUER,
      },
      sourceAccount: SOURCE_ACCOUNT,
    });

    await expect(
      service.submitPayment({
        paymentId: prepared.payment.id,
        signedTransactionXdr: prepared.transactionXdr,
      }),
    ).rejects.toThrow('op_no_destination');
  });

  it('throws when a submitted payment is not pending', async () => {
    const server = buildServer();
    const service = new StellarPathPaymentService(server);

    await expect(
      service.submitPayment({
        paymentId: 'missing-payment',
        signedTransactionXdr: 'xdr',
      }),
    ).rejects.toThrow('Path payment not found');
  });

  it('reuses the fallback quote when strict send is available but no receive path exists', async () => {
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockRejectedValue(new Error('path lookup failed')),
    });
    (server.strictSendPaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [makePathRecord('9.5000000', 0)],
      }),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });

    const service = new StellarPathPaymentService(server);
    const prepared = await service.preparePayment({
      userId: 'user-1',
      plan: 'premium_monthly',
      sourceAsset: {
        code: 'USDC',
        issuer: SOURCE_ISSUER,
      },
      sourceAccount: SOURCE_ACCOUNT,
    });

    expect(prepared.quote.mode).toBe('direct-xlm');
    expect(prepared.quote.sourceAmount).toBe('9.5000000');
  });

  it('uses the receiving secret when no public key is configured', async () => {
    process.env.STELLAR_RECEIVING_PUBLIC_KEY = '';
    process.env.STELLAR_RECEIVING_SECRET = SOURCE_SECRET;
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [makePathRecord('12.5000000', 1)],
      }),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });

    const service = new StellarPathPaymentService(server);
    const prepared = await service.preparePayment({
      userId: 'user-1',
      plan: 'premium_monthly',
      sourceAsset: {
        code: 'USDC',
        issuer: SOURCE_ISSUER,
      },
      sourceAccount: SOURCE_ACCOUNT,
    });

    expect(prepared.transactionXdr).toContain(DESTINATION_ACCOUNT);
  });

  it('uses the default server constructor when no server is provided', () => {
    const service = new StellarPathPaymentService();
    expect(service).toBeInstanceOf(StellarPathPaymentService);
    expect(require('@stellar/stellar-sdk').Horizon.Server).toHaveBeenCalled();
  });

  it('formats exchange rates and fees without trailing zeroes', async () => {
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [makePathRecord('10.0000000', 1)],
      }),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });

    const service = new StellarPathPaymentService(server);
    const prepared = await service.preparePayment({
      userId: 'user-1',
      plan: 'premium_monthly',
      sourceAsset: {
        code: 'USDC',
        issuer: SOURCE_ISSUER,
      },
      sourceAccount: SOURCE_ACCOUNT,
    });

    expect(prepared.quote.exchangeRate).toBe('1.001001');
    expect(prepared.quote.estimatedNetworkFee).toBe('0.0000100');
  });

  it('formats zero-valued exchange rates as zero', async () => {
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [makePathRecord('0.0000000', 1)],
      }),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });

    const service = new StellarPathPaymentService(server);
    const prepared = await service.preparePayment({
      userId: 'user-1',
      plan: 'premium_monthly',
      sourceAsset: {
        code: 'USDC',
        issuer: SOURCE_ISSUER,
      },
      sourceAccount: SOURCE_ACCOUNT,
    });

    expect(prepared.quote.exchangeRate).toBe('0');
  });

  it('throws when no receiving account env vars are configured', async () => {
    process.env.STELLAR_RECEIVING_PUBLIC_KEY = '';
    process.env.STELLAR_RECEIVING_SECRET = '';
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [makePathRecord('12.5000000', 1)],
      }),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });

    const service = new StellarPathPaymentService(server);

    await expect(
      service.preparePayment({
        userId: 'user-1',
        plan: 'premium_monthly',
        sourceAsset: {
          code: 'USDC',
          issuer: SOURCE_ISSUER,
        },
        sourceAccount: SOURCE_ACCOUNT,
      }),
    ).rejects.toThrow('STELLAR_RECEIVING_SECRET or STELLAR_RECEIVING_PUBLIC_KEY is required');
  });

  it('falls back with a generic reason when Horizon path lookup throws', async () => {
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockRejectedValue('boom'),
    });
    (server.strictSendPaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockRejectedValue(new Error('fallback failed')),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });

    const service = new StellarPathPaymentService(server);
    const prepared = await service.preparePayment({
      userId: 'user-1',
      plan: 'premium_monthly',
      sourceAsset: {
        code: 'USDC',
        issuer: SOURCE_ISSUER,
      },
      sourceAccount: SOURCE_ACCOUNT,
    });

    expect(prepared.quote.fallbackReason).toBe('Path not found');
  });

  it('confirms a payment and records a submitted audit entry', async () => {
    const server = buildServer();
    (server.strictReceivePaths as jest.Mock).mockReturnValue({
      call: jest.fn().mockResolvedValue({
        records: [makePathRecord('12.5000000', 1)],
      }),
    });
    (server.loadAccount as jest.Mock).mockResolvedValue({
      accountId: SOURCE_ACCOUNT,
      sequence: '123',
    });
    (server.submitTransaction as jest.Mock).mockResolvedValue({ hash: 'tx-hash-1', ledger: 123 });

    const service = new StellarPathPaymentService(server);
    const prepared = await service.preparePayment({
      userId: 'user-1',
      plan: 'premium_monthly',
      sourceAsset: {
        code: 'USDC',
        issuer: SOURCE_ISSUER,
      },
      sourceAccount: SOURCE_ACCOUNT,
    });

    const submitted = await service.submitPayment({
      paymentId: prepared.payment.id,
      signedTransactionXdr: prepared.transactionXdr,
    });

    expect(submitted.transactionHash).toBe('tx-hash-1');
    expect(service.getAudits(prepared.payment.id)).toHaveLength(2);
  });

  it('exposes the shared singleton instance', () => {
    expect(stellarPathPaymentService).toBeInstanceOf(StellarPathPaymentService);
  });
});
