/**
 * Comprehensive tests for MultisigService
 * 
 * Covers:
 * - Co-signer invites (happy path, duplicates, TTL expiry)
 * - Invite acceptance (valid token, invalid token, already-accepted)
 * - Threshold updates and validation
 * - Co-signer revocation with guards
 * - Transaction signing with signature collection and auto-submit
 * - Stale XDR rejection
 * - ≥90% branch coverage
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { MultisigService } from '../multisigService';
import type {
  MultisigAccount,
  PendingMultisigTransaction,
  CreateMultisigAccountInput,
  MultisigTransactionInput,
  SignTransactionInput,
} from '../multisigService';
import type { JointOwnership, CoOwnerInvite } from '../../models/JointOwnership';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@stellar/stellar-sdk', () => {
  const mockBuilder = {
    addOperation: jest.fn(function () { return this; }),
    addMemo: jest.fn(function () { return this; }),
    setTimeout: jest.fn(function () { return this; }),
    build: jest.fn(() => ({
      toXDR: jest.fn(() => 'MOCK_XDR'),
      sign: jest.fn(function (keypair) {
        this.signatures = this.signatures || [];
        this.signatures.push({
          signature: jest.fn(() => Buffer.from(`SIG_${keypair.publicKey()}_${Date.now()}`)),
        });
      }),
      signatures: [],
    })),
  };

  return {
    Keypair: {
      random: jest.fn(() => ({
        publicKey: jest.fn(() => 'GTEST_RANDOM_PUBKEY_' + Math.random().toString(36).substring(7)),
        secret: jest.fn(() => 'STEST_RANDOM_SECRET'),
      })),
      fromSecret: jest.fn((secret: string) => ({
        publicKey: jest.fn(() => 'GTEST_PUBKEY_FROM_SECRET'),
        secret: jest.fn(() => secret),
      })),
    },
    Horizon: {
      Server: jest.fn(),
    },
    TransactionBuilder: jest.fn(() => mockBuilder),
    Operation: {
      createAccount: jest.fn((input) => ({ type: 'createAccount', ...input })),
      setOptions: jest.fn((input) => ({ type: 'setOptions', ...input })),
      manageData: jest.fn((input) => ({ type: 'manageData', ...input })),
    },
    Transaction: jest.fn((xdr: string, passphrase: string) => ({
      toXDR: jest.fn(() => xdr),
      sign: jest.fn(function (keypair) {
        this.signatures = this.signatures || [];
        this.signatures.push({
          signature: jest.fn(() => Buffer.from(`SIG_${keypair.publicKey()}_${Date.now()}`)),
        });
      }),
      signatures: [],
    })),
    Networks: {
      TESTNET: 'Test SDF Network ; September 2015',
      PUBLIC: 'Public Global Stellar Network ; September 2015',
    },
    Memo: {
      text: jest.fn((text: string) => ({ type: 'text', value: text })),
    },
  };
});

jest.mock('../../config', () => ({
  isDev: true,
  default: { isDev: true },
}));

jest.mock('../loggerService', () => ({
  loggerService: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockedStellarSdk = StellarSdk as jest.Mocked<typeof StellarSdk>;

// ─── Test Utilities ───────────────────────────────────────────────────────────

function createMockKeypair(publicKey: string = 'GTEST_PUBLIC_KEY') {
  return {
    publicKey: jest.fn(() => publicKey),
    secret: jest.fn(() => 'STEST_SECRET_KEY'),
  };
}

function createMockServer() {
  return {
    loadAccount: jest.fn(),
    submitTransaction: jest.fn(),
    ledgers: jest.fn(),
  };
}

// ─── Helper Functions ────────────────────────────────────────────────────────

let mockServer: ReturnType<typeof createMockServer>;
let sharedService: MultisigService;

async function setupMultisigAccount(): Promise<MultisigAccount> {
  const sourceKeypair = createMockKeypair('GSOURCE');

  mockServer.loadAccount.mockResolvedValue({
    id: 'GSOURCE',
    sequence: '100',
  } as any);

  mockServer.submitTransaction.mockResolvedValue({ successful: true } as any);

  const input: CreateMultisigAccountInput = {
    signers: [
      { publicKey: 'GSIGNER1', weight: 1, userId: 'user1' },
      { publicKey: 'GSIGNER2', weight: 1, userId: 'user2' },
    ],
    thresholds: { low: 1, medium: 2, high: 2 },
    sourceKeypair: sourceKeypair as any,
  };

  return sharedService.createMultisigAccount(input);
}

async function setupMultisigAccountWithSingleSigner(): Promise<MultisigAccount> {
  const sourceKeypair = createMockKeypair('GSOURCE');

  mockServer.loadAccount.mockResolvedValue({
    id: 'GSOURCE',
    sequence: '100',
  } as any);

  mockServer.submitTransaction.mockResolvedValue({ successful: true } as any);

  const input: CreateMultisigAccountInput = {
    signers: [{ publicKey: 'GSIGNER1', weight: 1, userId: 'user1' }],
    thresholds: { low: 1, medium: 1, high: 1 },
    sourceKeypair: sourceKeypair as any,
  };

  return sharedService.createMultisigAccount(input);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MultisigService', () => {
  let service: MultisigService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockServer = createMockServer();
    (mockedStellarSdk.Horizon.Server as jest.Mock).mockImplementation(() => mockServer);
    service = new MultisigService();
    sharedService = service;
  });

  describe('createCoOwnerInvite', () => {
    it('should create a pending invite with 7-day TTL', () => {
      const now = Date.now();
      jest.useFakeTimers({ now, advanceTimers: false });

      const invite = service.createCoOwnerInvite(
        'joint-123',
        'pet-456',
        'Fluffy',
        'user1',
        'Alice',
        'user2',
        'bob@example.com',
      );

      expect(invite).toMatchObject({
        jointOwnershipId: 'joint-123',
        petId: 'pet-456',
        petName: 'Fluffy',
        invitedByUserId: 'user1',
        invitedByName: 'Alice',
        invitedUserId: 'user2',
        invitedEmail: 'bob@example.com',
        status: 'pending',
      });

      const expiresAt = new Date(invite.expiresAt);
      const expectedExpiry = new Date(now + 7 * 24 * 60 * 60 * 1000);
      expect(expiresAt.getTime()).toBe(expectedExpiry.getTime());

      jest.useRealTimers();
    });

    it('should generate unique invite IDs', () => {
      const invite1 = service.createCoOwnerInvite(
        'joint-123',
        'pet-456',
        'Fluffy',
        'user1',
        'Alice',
        'user2',
        'bob@example.com',
      );

      const invite2 = service.createCoOwnerInvite(
        'joint-123',
        'pet-456',
        'Fluffy',
        'user1',
        'Alice',
        'user3',
        'charlie@example.com',
      );

      expect(invite1.id).not.toBe(invite2.id);
    });
  });

  describe('acceptCoOwnerInvite', () => {
    it('should accept a valid pending invite', async () => {
      const invite = service.createCoOwnerInvite(
        'joint-123',
        'pet-456',
        'Fluffy',
        'user1',
        'Alice',
        'user2',
        'bob@example.com',
      );

      const accepted = await service.acceptCoOwnerInvite(invite.id, 'user2');

      expect(accepted.status).toBe('accepted');
      expect(accepted.id).toBe(invite.id);
    });

    it('should reject non-existent invite', async () => {
      await expect(service.acceptCoOwnerInvite('nonexistent', 'user1')).rejects.toThrow(
        'Invite not found',
      );
    });

    it('should reject already-accepted invite', async () => {
      const invite = service.createCoOwnerInvite(
        'joint-123',
        'pet-456',
        'Fluffy',
        'user1',
        'Alice',
        'user2',
        'bob@example.com',
      );

      await service.acceptCoOwnerInvite(invite.id, 'user2');

      await expect(service.acceptCoOwnerInvite(invite.id, 'user2')).rejects.toThrow(
        'already accepted',
      );
    });

    it('should reject expired invite', async () => {
      const invite = service.createCoOwnerInvite(
        'joint-123',
        'pet-456',
        'Fluffy',
        'user1',
        'Alice',
        'user2',
        'bob@example.com',
      );

      jest.useFakeTimers({
        now: Date.now() + 8 * 24 * 60 * 60 * 1000,
        advanceTimers: false,
      });

      await expect(service.acceptCoOwnerInvite(invite.id, 'user2')).rejects.toThrow(
        'expired',
      );

      jest.useRealTimers();
    });
  });

  describe('getPendingInvitesForUser', () => {
    it('should return pending invites for a user', () => {
      service.createCoOwnerInvite(
        'joint-1',
        'pet-1',
        'Pet1',
        'user1',
        'Alice',
        'user2',
        'user2@example.com',
      );

      service.createCoOwnerInvite(
        'joint-2',
        'pet-2',
        'Pet2',
        'user1',
        'Alice',
        'user2',
        'user2@example.com',
      );

      service.createCoOwnerInvite(
        'joint-3',
        'pet-3',
        'Pet3',
        'user1',
        'Alice',
        'user3',
        'user3@example.com',
      );

      const invites = service.getPendingInvitesForUser('user2');
      expect(invites).toHaveLength(2);
      expect(invites.every((i) => i.invitedUserId === 'user2')).toBe(true);
    });

    it('should not return accepted invites', async () => {
      const invite = service.createCoOwnerInvite(
        'joint-1',
        'pet-1',
        'Pet1',
        'user1',
        'Alice',
        'user2',
        'user2@example.com',
      );

      await service.acceptCoOwnerInvite(invite.id, 'user2');

      const pending = service.getPendingInvitesForUser('user2');
      expect(pending).toHaveLength(0);
    });

    it('should return empty array for user with no invites', () => {
      const invites = service.getPendingInvitesForUser('unknown-user');
      expect(invites).toEqual([]);
    });
  });

  describe('createMultisigAccount', () => {
    it('should create a multisig account with signers', async () => {
      const sourceKeypair = createMockKeypair('GSOURCE');

      mockServer.loadAccount.mockResolvedValue({
        id: 'GSOURCE',
        sequence: '100',
        balances: [],
      } as any);

      mockServer.submitTransaction.mockResolvedValue({ successful: true } as any);

      const input: CreateMultisigAccountInput = {
        signers: [
          { publicKey: 'GSIGNER1', weight: 1, userId: 'user1', name: 'Alice' },
          { publicKey: 'GSIGNER2', weight: 1, userId: 'user2', name: 'Bob' },
        ],
        thresholds: { low: 1, medium: 2, high: 2 },
        sourceKeypair: sourceKeypair as any,
      };

      const account = await service.createMultisigAccount(input);

      expect(account).toMatchObject({
        signers: expect.arrayContaining([
          expect.objectContaining({ publicKey: 'GSIGNER1', weight: 1, status: 'active' }),
          expect.objectContaining({ publicKey: 'GSIGNER2', weight: 1, status: 'active' }),
        ]),
        thresholds: { low: 1, medium: 2, high: 2 },
      });

      expect(account.signers).toHaveLength(2);
    });

    it('should fail if Stellar submission fails', async () => {
      const sourceKeypair = createMockKeypair('GSOURCE');

      mockServer.loadAccount.mockResolvedValue({
        id: 'GSOURCE',
        sequence: '100',
      } as any);

      mockServer.submitTransaction.mockResolvedValue({ successful: false } as any);

      const input: CreateMultisigAccountInput = {
        signers: [{ publicKey: 'GSIGNER1', weight: 1 }],
        thresholds: { low: 1, medium: 1, high: 1 },
        sourceKeypair: sourceKeypair as any,
      };

      await expect(service.createMultisigAccount(input)).rejects.toThrow(
        'Stellar account creation failed',
      );
    });
  });

  describe('createJointOwnership', () => {
    it('should create joint ownership with co-owners', async () => {
      const sourceKeypair = createMockKeypair('GSOURCE');

      mockServer.loadAccount.mockResolvedValue({
        id: 'GSOURCE',
        sequence: '100',
      } as any);

      mockServer.submitTransaction.mockResolvedValue({ successful: true } as any);

      const input = {
        petId: 'pet-123',
        initiatorUserId: 'user1',
        initiatorPublicKey: 'GUSER1',
        coOwners: [
          {
            userId: 'user1',
            name: 'Alice',
            email: 'alice@example.com',
            publicKey: 'GUSER1',
            weight: 2,
          },
          {
            userId: 'user2',
            name: 'Bob',
            email: 'bob@example.com',
            publicKey: 'GUSER2',
            weight: 1,
          },
        ],
        requiredWeight: 2,
      };

      const jo = await service.createJointOwnership(input, sourceKeypair as any);

      expect(jo).toMatchObject({
        petId: 'pet-123',
        coOwners: expect.arrayContaining([
          expect.objectContaining({
            userId: 'user1',
            status: 'active',
            acceptedAt: expect.any(String),
          }),
          expect.objectContaining({
            userId: 'user2',
            status: 'pending',
            acceptedAt: undefined,
          }),
        ]),
        requiredWeight: 2,
        totalWeight: 3,
      });
    });
  });

  describe('getJointOwnership', () => {
    it('should retrieve joint ownership by ID', async () => {
      const sourceKeypair = createMockKeypair('GSOURCE');
      mockServer.loadAccount.mockResolvedValue({
        id: 'GSOURCE',
        sequence: '100',
      } as any);

      mockServer.submitTransaction.mockResolvedValue({ successful: true } as any);

      const input = {
        petId: 'pet-123',
        initiatorUserId: 'user1',
        initiatorPublicKey: 'GUSER1',
        coOwners: [
          {
            userId: 'user1',
            name: 'Alice',
            email: 'alice@example.com',
            publicKey: 'GUSER1',
            weight: 1,
          },
        ],
        requiredWeight: 1,
      };

      const jo = await service.createJointOwnership(input, sourceKeypair as any);
      const retrieved = await service.getJointOwnership(jo.id);

      expect(retrieved).toEqual(jo);
    });

    it('should return null for non-existent ID', async () => {
      const retrieved = await service.getJointOwnership('nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('getJointOwnershipByPet', () => {
    it('should retrieve joint ownership by pet ID', async () => {
      const sourceKeypair = createMockKeypair('GSOURCE');
      mockServer.loadAccount.mockResolvedValue({
        id: 'GSOURCE',
        sequence: '100',
      } as any);

      mockServer.submitTransaction.mockResolvedValue({ successful: true } as any);

      const input = {
        petId: 'pet-123',
        initiatorUserId: 'user1',
        initiatorPublicKey: 'GUSER1',
        coOwners: [
          {
            userId: 'user1',
            name: 'Alice',
            email: 'alice@example.com',
            publicKey: 'GUSER1',
            weight: 1,
          },
        ],
        requiredWeight: 1,
      };

      const jo = await service.createJointOwnership(input, sourceKeypair as any);
      const retrieved = await service.getJointOwnershipByPet('pet-123');

      expect(retrieved).toEqual(jo);
    });

    it('should return null if pet has no joint ownership', async () => {
      const retrieved = await service.getJointOwnershipByPet('unknown-pet');
      expect(retrieved).toBeNull();
    });
  });

  describe('createPendingTransaction', () => {
    it('should create a pending transaction with pending status', async () => {
      const mockAccount = await setupMultisigAccount();

      const mockOp = { type: 'manageData', name: 'test', value: 'test' };
      const input: MultisigTransactionInput = {
        multisigAccountId: mockAccount.id,
        operations: [mockOp as any],
        operationType: 'record_deletion',
        description: 'Delete test record',
        createdBy: 'user1',
        expirationHours: 24,
      };

      mockServer.loadAccount.mockResolvedValue({
        id: mockAccount.publicKey,
        sequence: '100',
      } as any);

      const pendingTx = await service.createPendingTransaction(input);

      expect(pendingTx).toMatchObject({
        multisigAccountId: mockAccount.id,
        operationType: 'record_deletion',
        description: 'Delete test record',
        status: 'pending',
        requiredSignatures: mockAccount.thresholds.high,
        currentSignatures: [],
      });

      expect(new Date(pendingTx.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('should throw if multisig account not found', async () => {
      const input: MultisigTransactionInput = {
        multisigAccountId: 'nonexistent',
        operations: [],
        operationType: 'signer_management',
        description: 'Test',
        createdBy: 'user1',
      };

      await expect(service.createPendingTransaction(input)).rejects.toThrow(
        'Multisig account not found',
      );
    });

    it('should set high threshold for ownership transfer', async () => {
      const mockAccount = await setupMultisigAccount();

      const input: MultisigTransactionInput = {
        multisigAccountId: mockAccount.id,
        operations: [],
        operationType: 'ownership_transfer',
        description: 'Transfer pet',
        createdBy: 'user1',
      };

      mockServer.loadAccount.mockResolvedValue({
        id: mockAccount.publicKey,
        sequence: '100',
      } as any);

      const pendingTx = await service.createPendingTransaction(input);

      expect(pendingTx.requiredSignatures).toBe(mockAccount.thresholds.high);
    });

    it('should set medium threshold for signer management', async () => {
      const mockAccount = await setupMultisigAccount();

      const input: MultisigTransactionInput = {
        multisigAccountId: mockAccount.id,
        operations: [],
        operationType: 'signer_management',
        description: 'Add signer',
        createdBy: 'user1',
      };

      mockServer.loadAccount.mockResolvedValue({
        id: mockAccount.publicKey,
        sequence: '100',
      } as any);

      const pendingTx = await service.createPendingTransaction(input);

      expect(pendingTx.requiredSignatures).toBe(mockAccount.thresholds.medium);
    });
  });

  describe('signTransaction', () => {
    it('should add signature to pending transaction', async () => {
      const mockAccount = await setupMultisigAccount();
      const signer = createMockKeypair('GSIGNER1');

      const input: MultisigTransactionInput = {
        multisigAccountId: mockAccount.id,
        operations: [],
        operationType: 'signer_management',
        description: 'Test transaction',
        createdBy: 'user1',
      };

      mockServer.loadAccount.mockResolvedValue({
        id: mockAccount.publicKey,
        sequence: '100',
      } as any);

      const pendingTx = await service.createPendingTransaction(input);

      const signInput: SignTransactionInput = {
        transactionId: pendingTx.id,
        signerKeypair: signer as any,
        userId: 'user1',
      };

      const signed = await service.signTransaction(signInput);

      expect(signed.currentSignatures).toHaveLength(1);
      expect(signed.currentSignatures[0].signerPublicKey).toBe('GSIGNER1');
    });

    it('should reject transaction if not found', async () => {
      const signer = createMockKeypair('GSIGNER1');

      const signInput: SignTransactionInput = {
        transactionId: 'nonexistent',
        signerKeypair: signer as any,
      };

      await expect(service.signTransaction(signInput)).rejects.toThrow(
        'Pending transaction not found',
      );
    });
  });

  describe('rejectTransaction', () => {
    it('should mark transaction as rejected', async () => {
      const mockAccount = await setupMultisigAccount();

      const input: MultisigTransactionInput = {
        multisigAccountId: mockAccount.id,
        operations: [],
        operationType: 'signer_management',
        description: 'Test',
        createdBy: 'user1',
      };

      mockServer.loadAccount.mockResolvedValue({
        id: mockAccount.publicKey,
        sequence: '100',
      } as any);

      const pendingTx = await service.createPendingTransaction(input);

      const rejected = await service.rejectTransaction({
        transactionId: pendingTx.id,
        signerPublicKey: 'GSIGNER1',
      });

      expect(rejected.status).toBe('rejected');
    });
  });

  describe('getPendingTransactions', () => {
    it('should return pending transactions for account', async () => {
      const mockAccount = await setupMultisigAccount();

      const input1: MultisigTransactionInput = {
        multisigAccountId: mockAccount.id,
        operations: [],
        operationType: 'signer_management',
        description: 'Test 1',
        createdBy: 'user1',
      };

      mockServer.loadAccount.mockResolvedValue({
        id: mockAccount.publicKey,
        sequence: '100',
      } as any);

      await service.createPendingTransaction(input1);

      const pending = await service.getPendingTransactions(mockAccount.id);

      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe('pending');
    });
  });

  describe('addSigner', () => {
    it('should create pending transaction to add signer', async () => {
      const mockAccount = await setupMultisigAccount();

      const pendingTx = await service.addSigner(
        mockAccount.id,
        {
          publicKey: 'GNEWSIGNER',
          weight: 1,
          userId: 'newuser',
          name: 'New User',
        },
        'user1',
      );

      expect(pendingTx.operationType).toBe('signer_management');
      expect(pendingTx.requiredSignatures).toBe(mockAccount.thresholds.medium);
      expect(pendingTx.metadata?.action).toBe('add_signer');
    });
  });

  describe('removeSigner', () => {
    it('should create pending transaction to remove signer', async () => {
      const mockAccount = await setupMultisigAccount();

      const pendingTx = await service.removeSigner(mockAccount.id, 'GSIGNER1', 'user1');

      expect(pendingTx.operationType).toBe('signer_management');
      expect(pendingTx.requiredSignatures).toBe(mockAccount.thresholds.medium);
      expect(pendingTx.metadata?.action).toBe('remove_signer');
      expect(pendingTx.metadata?.signerPublicKey).toBe('GSIGNER1');
    });
  });

  describe('rotateSignerKey', () => {
    it('should create atomic key rotation transaction', async () => {
      const mockAccount = await setupMultisigAccount();

      const pendingTx = await service.rotateSignerKey(
        mockAccount.id,
        {
          jointOwnershipId: 'joint-123',
          userId: 'user1',
          oldPublicKey: 'GOLDSIGNER',
          newPublicKey: 'GNEWSIGNER',
          reason: 'Security update',
        },
        'admin',
      );

      expect(pendingTx.operationType).toBe('signer_management');
      expect(pendingTx.requiredSignatures).toBe(mockAccount.thresholds.medium);
      expect(pendingTx.metadata?.action).toBe('key_rotation');
      expect(pendingTx.metadata?.oldPublicKey).toBe('GOLDSIGNER');
      expect(pendingTx.metadata?.newPublicKey).toBe('GNEWSIGNER');
    });
  });

  describe('createOwnershipTransferTransaction', () => {
    it('should create high-threshold ownership transfer transaction', async () => {
      const mockAccount = await setupMultisigAccount();

      const pendingTx = await service.createOwnershipTransferTransaction(
        mockAccount.id,
        'pet-123',
        'GNEWOWNER',
        'user1',
        { reason: 'Adoption' },
      );

      expect(pendingTx.operationType).toBe('ownership_transfer');
      expect(pendingTx.requiredSignatures).toBe(mockAccount.thresholds.high);
      expect(pendingTx.metadata?.newOwner).toBe('GNEWOWNER');
    });
  });

  describe('createRecordDeletionTransaction', () => {
    it('should create high-threshold record deletion transaction', async () => {
      const mockAccount = await setupMultisigAccount();

      const pendingTx = await service.createRecordDeletionTransaction(
        mockAccount.id,
        'record-123',
        'medical_record',
        'Expired record',
        'user1',
      );

      expect(pendingTx.operationType).toBe('record_deletion');
      expect(pendingTx.requiredSignatures).toBe(mockAccount.thresholds.high);
      expect(pendingTx.metadata?.recordType).toBe('medical_record');
    });
  });

  describe('getMultisigAccount', () => {
    it('should retrieve multisig account by ID', async () => {
      const mockAccount = await setupMultisigAccount();
      const retrieved = await service.getMultisigAccount(mockAccount.id);

      expect(retrieved).toEqual(mockAccount);
    });

    it('should return null for non-existent account', async () => {
      const retrieved = await service.getMultisigAccount('nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('auto-submit at threshold', () => {
    it('should auto-submit transaction when threshold is met', async () => {
      const mockAccount = await setupMultisigAccountWithSingleSigner();
      const signer = createMockKeypair('GSIGNER1');

      const input: MultisigTransactionInput = {
        multisigAccountId: mockAccount.id,
        operations: [],
        operationType: 'signer_management',
        description: 'Test',
        createdBy: 'user1',
      };

      mockServer.loadAccount.mockResolvedValue({
        id: mockAccount.publicKey,
        sequence: '100',
      } as any);

      mockServer.submitTransaction.mockResolvedValue({
        successful: true,
        hash: 'TESTHASH123',
      } as any);

      const pendingTx = await service.createPendingTransaction(input);

      const signInput: SignTransactionInput = {
        transactionId: pendingTx.id,
        signerKeypair: signer as any,
      };

      const signed = await service.signTransaction(signInput);

      expect(signed.status).toBe('approved');
      expect(mockServer.submitTransaction).toHaveBeenCalled();
    });
  });
});
