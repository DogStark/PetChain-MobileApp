import {
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  Transaction,
  Memo,
  Horizon,
  type xdr,
} from '@stellar/stellar-sdk';
import CryptoJS from 'crypto-js';

import config from '../config';
import { loggerService } from './loggerService';
import type {
  JointOwnership,
  CoOwner,
  CreateJointOwnershipInput,
  CoOwnerInvite,
  KeyRotationRequest,
} from '../models/JointOwnership';

type StellarServer = Horizon.Server;
// The TransactionBuilder.addOperation accepts xdr.Operation at the type level
type StellarOperation = xdr.Operation;

// Support both legacy top-level Server export (mocks) and current Horizon.Server
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _sdk = require('@stellar/stellar-sdk') as any;

const _StellarServer: new (url: string) => StellarServer =
  _sdk.Server ?? _sdk.Horizon?.Server ?? _sdk.default?.Horizon?.Server;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MultisigAccount {
  id: string;
  publicKey: string;
  signers: MultisigSigner[];
  thresholds: { low: number; medium: number; high: number };
  createdAt: string;
  updatedAt: string;
}

export interface MultisigSigner {
  publicKey: string;
  weight: number;
  userId?: string;
  name?: string;
  email?: string;
  status: 'active' | 'pending' | 'revoked';
  addedAt: string;
}

export interface PendingMultisigTransaction {
  id: string;
  multisigAccountId: string;
  transactionXdr: string;
  operationType: 'ownership_transfer' | 'record_deletion' | 'signer_management';
  description: string;
  requiredSignatures: number;
  currentSignatures: MultisigSignature[];
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdBy: string;
  expiresAt: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface MultisigSignature {
  signerPublicKey: string;
  signature: string;
  userId?: string;
  signedAt: string;
}

export interface CreateMultisigAccountInput {
  signers: {
    publicKey: string;
    weight: number;
    userId?: string;
    name?: string;
    email?: string;
  }[];
  thresholds: { low: number; medium: number; high: number };
  /** Funded source keypair that pays for account creation */
  sourceKeypair: Keypair;
}

export interface MultisigTransactionInput {
  multisigAccountId: string;
  operations: StellarOperation[];
  memo?: string;
  operationType: 'ownership_transfer' | 'record_deletion' | 'signer_management';
  description: string;
  createdBy: string;
  expirationHours?: number;
  metadata?: Record<string, unknown>;
}

export interface SignTransactionInput {
  transactionId: string;
  signerKeypair: Keypair;
  userId?: string;
}

export interface RejectTransactionInput {
  transactionId: string;
  signerPublicKey: string;
  userId?: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const STELLAR_CONFIG = {
  horizonUrl: config.isDev ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org',
  networkPassphrase: config.isDev ? Networks.TESTNET : Networks.PUBLIC,
  baseFee: '100000', // 0.01 XLM
  timeout: 300, // 5 minutes
  /** Minimum XLM balance per signer entry (0.5 XLM base reserve) */
  baseReserveXlm: 0.5,
  /** Starting balance: 1 XLM base + 0.5 per signer + 0.5 per data entry */
  startingBalanceXlm: (signerCount: number) => (1 + signerCount * 0.5 + 1).toFixed(7),
};

// ─── Multisig Service ─────────────────────────────────────────────────────────

export class MultisigService {
  private server: StellarServer;
  // In production these Maps would be backed by a database
  private pendingTransactions = new Map<string, PendingMultisigTransaction>();
  private multisigAccounts = new Map<string, MultisigAccount>();
  private jointOwnerships = new Map<string, JointOwnership>();
  private coOwnerInvites = new Map<string, CoOwnerInvite>();

  constructor() {
    const ServerCtor: new (url: string) => StellarServer =
      (Horizon as any).Server ?? (Horizon as any).default?.Server ?? Horizon.Server;
    this.server = new ServerCtor(STELLAR_CONFIG.horizonUrl);
  }

  // ─── Account Creation ───────────────────────────────────────────────────────

  /**
   * Create a new Stellar multisig account for joint pet ownership.
   * The sourceKeypair must be funded (e.g. from a faucet on testnet).
   */
  async createMultisigAccount(input: CreateMultisigAccountInput): Promise<MultisigAccount> {
    try {
      const multisigKeypair = Keypair.random();
      const sourceAccount = await this.server.loadAccount(input.sourceKeypair.publicKey());
      const startingBalance = STELLAR_CONFIG.startingBalanceXlm(input.signers.length);

      const txBuilder = new TransactionBuilder(sourceAccount, {
        fee: STELLAR_CONFIG.baseFee,
        networkPassphrase: STELLAR_CONFIG.networkPassphrase,
      })
        .addOperation(
          Operation.createAccount({
            destination: multisigKeypair.publicKey(),
            startingBalance,
          }) as unknown as StellarOperation,
        )
        .setTimeout(STELLAR_CONFIG.timeout);

      // Add each co-owner as a signer
      for (const signer of input.signers) {
        txBuilder.addOperation(
          Operation.setOptions({
            source: multisigKeypair.publicKey(),
            signer: { ed25519PublicKey: signer.publicKey, weight: signer.weight },
          }) as unknown as StellarOperation,
        );
      }

      // Set M-of-N thresholds
      txBuilder.addOperation(
        Operation.setOptions({
          source: multisigKeypair.publicKey(),
          lowThreshold: input.thresholds.low,
          medThreshold: input.thresholds.medium,
          highThreshold: input.thresholds.high,
        }) as unknown as StellarOperation,
      );

      // Remove master key so only the declared signers can authorize
      txBuilder.addOperation(
        Operation.setOptions({
          source: multisigKeypair.publicKey(),
          masterWeight: 0,
        }) as unknown as StellarOperation,
      );

      const tx = txBuilder.build();
      tx.sign(input.sourceKeypair);
      tx.sign(multisigKeypair);

      const result = await this.server.submitTransaction(tx);
      if (!result.successful) {
        throw new Error(`Stellar account creation failed: ${JSON.stringify(result)}`);
      }

      const account: MultisigAccount = {
        id: this.generateId(),
        publicKey: multisigKeypair.publicKey(),
        signers: input.signers.map((s) => ({
          ...s,
          status: 'active' as const,
          addedAt: new Date().toISOString(),
        })),
        thresholds: input.thresholds,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.multisigAccounts.set(account.id, account);
      loggerService.info('Multisig account created', {
        accountId: account.id,
        publicKey: account.publicKey,
        signerCount: input.signers.length,
      });
      return account;
    } catch (error) {
      loggerService.error('Failed to create multisig account', { error });
      throw error;
    }
  }

  // ─── Joint Ownership ────────────────────────────────────────────────────────

  /**
   * Create a JointOwnership record linking a pet to a multisig account.
   * Caller is responsible for funding the source keypair before calling this.
   */
  async createJointOwnership(
    input: CreateJointOwnershipInput,
    sourceKeypair: Keypair,
  ): Promise<JointOwnership> {
    const totalWeight = input.coOwners.reduce((sum, o) => sum + o.weight, 0);
    const thresholds = {
      low: Math.ceil(totalWeight * 0.34),
      medium: Math.ceil(totalWeight * 0.51),
      high: input.requiredWeight,
    };

    const account = await this.createMultisigAccount({
      signers: input.coOwners.map((o) => ({
        publicKey: o.publicKey,
        weight: o.weight,
        userId: o.userId,
        name: o.name,
        email: o.email,
      })),
      thresholds,
      sourceKeypair,
    });

    const coOwners: CoOwner[] = input.coOwners.map((o) => ({
      userId: o.userId,
      name: o.name,
      email: o.email,
      publicKey: o.publicKey,
      weight: o.weight,
      status: o.userId === input.initiatorUserId ? 'active' : 'pending',
      invitedAt: new Date().toISOString(),
      acceptedAt: o.userId === input.initiatorUserId ? new Date().toISOString() : undefined,
    }));

    const jointOwnership: JointOwnership = {
      id: this.generateId(),
      petId: input.petId,
      multisigAccountId: account.id,
      multisigPublicKey: account.publicKey,
      coOwners,
      thresholds,
      requiredWeight: input.requiredWeight,
      totalWeight,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.jointOwnerships.set(jointOwnership.id, jointOwnership);
    loggerService.info('Joint ownership created', {
      jointOwnershipId: jointOwnership.id,
      petId: input.petId,
      coOwnerCount: coOwners.length,
    });
    return jointOwnership;
  }

  /** Get joint ownership by ID */
  async getJointOwnership(id: string): Promise<JointOwnership | null> {
    return this.jointOwnerships.get(id) ?? null;
  }

  /** Get joint ownership for a specific pet */
  async getJointOwnershipByPet(petId: string): Promise<JointOwnership | null> {
    for (const jo of this.jointOwnerships.values()) {
      if (jo.petId === petId) return jo;
    }
    return null;
  }

  /** Accept a co-owner invite — marks the co-owner as active */
  async acceptCoOwnerInvite(inviteId: string, userId: string): Promise<CoOwnerInvite> {
    const invite = this.coOwnerInvites.get(inviteId);
    if (!invite) throw new Error('Invite not found');
    if (invite.status !== 'pending') throw new Error(`Invite is already ${invite.status}`);
    if (new Date() > new Date(invite.expiresAt)) {
      invite.status = 'expired';
      throw new Error('Invite has expired');
    }

    invite.status = 'accepted';
    this.coOwnerInvites.set(inviteId, invite);

    const jo = this.jointOwnerships.get(invite.jointOwnershipId);
    if (jo) {
      const coOwner = jo.coOwners.find((c) => c.userId === userId);
      if (coOwner) {
        coOwner.status = 'active';
        coOwner.acceptedAt = new Date().toISOString();
        jo.updatedAt = new Date().toISOString();
        this.jointOwnerships.set(jo.id, jo);
      }
    }

    loggerService.info('Co-owner invite accepted', { inviteId, userId });
    return invite;
  }

  /** Create a co-owner invite */
  createCoOwnerInvite(
    jointOwnershipId: string,
    petId: string,
    petName: string,
    invitedByUserId: string,
    invitedByName: string,
    invitedUserId: string,
    invitedEmail: string,
  ): CoOwnerInvite {
    const invite: CoOwnerInvite = {
      id: this.generateId(),
      jointOwnershipId,
      petId,
      petName,
      invitedByUserId,
      invitedByName,
      invitedUserId,
      invitedEmail,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      createdAt: new Date().toISOString(),
    };
    this.coOwnerInvites.set(invite.id, invite);
    return invite;
  }

  /** Get pending invites for a user */
  getPendingInvitesForUser(userId: string): CoOwnerInvite[] {
    return Array.from(this.coOwnerInvites.values()).filter(
      (i) => i.invitedUserId === userId && i.status === 'pending',
    );
  }

  // ─── Transaction Management ─────────────────────────────────────────────────

  /** Build and store a pending multisig transaction awaiting co-signatures */
  async createPendingTransaction(
    input: MultisigTransactionInput,
  ): Promise<PendingMultisigTransaction> {
    try {
      const multisigAccount = this.multisigAccounts.get(input.multisigAccountId);
      if (!multisigAccount) throw new Error('Multisig account not found');

      const stellarAccount = await this.server.loadAccount(multisigAccount.publicKey);
      const txBuilder = new TransactionBuilder(stellarAccount, {
        fee: STELLAR_CONFIG.baseFee,
        networkPassphrase: STELLAR_CONFIG.networkPassphrase,
      });

      for (const op of input.operations) {
        txBuilder.addOperation(op);
      }
      if (input.memo) txBuilder.addMemo(Memo.text(input.memo));
      txBuilder.setTimeout(STELLAR_CONFIG.timeout);

      const tx = txBuilder.build();
      const requiredSignatures = this.getRequiredSignatures(
        input.operationType,
        multisigAccount.thresholds,
      );

      const pendingTx: PendingMultisigTransaction = {
        id: this.generateId(),
        multisigAccountId: input.multisigAccountId,
        transactionXdr: tx.toXDR(),
        operationType: input.operationType,
        description: input.description,
        requiredSignatures,
        currentSignatures: [],
        status: 'pending',
        createdBy: input.createdBy,
        expiresAt: new Date(
          Date.now() + (input.expirationHours ?? 48) * 60 * 60 * 1000,
        ).toISOString(),
        createdAt: new Date().toISOString(),
        metadata: input.metadata,
      };

      this.pendingTransactions.set(pendingTx.id, pendingTx);
      loggerService.info('Pending multisig transaction created', {
        transactionId: pendingTx.id,
        operationType: input.operationType,
        requiredSignatures,
        createdBy: input.createdBy,
      });
      return pendingTx;
    } catch (error) {
      loggerService.error('Failed to create pending transaction', { error });
      throw error;
    }
  }

  /** Add a signature to a pending transaction; submits to Stellar when threshold is met */
  async signTransaction(input: SignTransactionInput): Promise<PendingMultisigTransaction> {
    try {
      const pendingTx = this.pendingTransactions.get(input.transactionId);
      if (!pendingTx) throw new Error('Pending transaction not found');
      if (pendingTx.status !== 'pending') {
        throw new Error(`Transaction is ${pendingTx.status} and cannot be signed`);
      }
      if (new Date() > new Date(pendingTx.expiresAt)) {
        pendingTx.status = 'expired';
        this.pendingTransactions.set(input.transactionId, pendingTx);
        throw new Error('Transaction has expired');
      }

      const alreadySigned = pendingTx.currentSignatures.some(
        (s) => s.signerPublicKey === input.signerKeypair.publicKey(),
      );
      if (alreadySigned) throw new Error('Signer has already signed this transaction');

      const multisigAccount = this.multisigAccounts.get(pendingTx.multisigAccountId);
      if (!multisigAccount) throw new Error('Multisig account not found');

      const authorizedSigner = multisigAccount.signers.find(
        (s) => s.publicKey === input.signerKeypair.publicKey() && s.status === 'active',
      );
      if (!authorizedSigner) throw new Error('Signer is not authorized for this multisig account');

      const tx = new Transaction(pendingTx.transactionXdr, STELLAR_CONFIG.networkPassphrase);
      tx.sign(input.signerKeypair);

      const lastSig = tx.signatures[tx.signatures.length - 1];
      pendingTx.currentSignatures.push({
        signerPublicKey: input.signerKeypair.publicKey(),
        signature: lastSig.signature().toString('base64'),
        userId: input.userId,
        signedAt: new Date().toISOString(),
      });

      // Check accumulated weight against threshold
      const totalWeight = pendingTx.currentSignatures.reduce((sum, sig) => {
        const signer = multisigAccount.signers.find((s) => s.publicKey === sig.signerPublicKey);
        return sum + (signer?.weight ?? 0);
      }, 0);

      if (totalWeight >= pendingTx.requiredSignatures) {
        const result = await this.server.submitTransaction(tx);
        if (result.successful) {
          pendingTx.status = 'approved';
          loggerService.info('Multisig transaction submitted', {
            transactionId: input.transactionId,
            stellarTxHash: result.hash,
          });
        } else {
          throw new Error(`Stellar submission failed: ${JSON.stringify(result)}`);
        }
      }

      this.pendingTransactions.set(input.transactionId, pendingTx);
      loggerService.info('Transaction signed', {
        transactionId: input.transactionId,
        signerPublicKey: input.signerKeypair.publicKey(),
        totalWeight,
        requiredSignatures: pendingTx.requiredSignatures,
      });
      return pendingTx;
    } catch (error) {
      loggerService.error('Failed to sign transaction', { error });
      throw error;
    }
  }

  /** Reject a pending transaction */
  async rejectTransaction(input: RejectTransactionInput): Promise<PendingMultisigTransaction> {
    const pendingTx = this.pendingTransactions.get(input.transactionId);
    if (!pendingTx) throw new Error('Pending transaction not found');
    if (pendingTx.status !== 'pending') {
      throw new Error(`Transaction is already ${pendingTx.status}`);
    }

    const multisigAccount = this.multisigAccounts.get(pendingTx.multisigAccountId);
    const isAuthorized = multisigAccount?.signers.some(
      (s) => s.publicKey === input.signerPublicKey && s.status === 'active',
    );
    if (!isAuthorized) throw new Error('Signer is not authorized for this multisig account');

    pendingTx.status = 'rejected';
    this.pendingTransactions.set(input.transactionId, pendingTx);
    loggerService.info('Transaction rejected', {
      transactionId: input.transactionId,
      rejectedBy: input.signerPublicKey,
    });
    return pendingTx;
  }

  /** Get all pending transactions for a multisig account */
  async getPendingTransactions(multisigAccountId: string): Promise<PendingMultisigTransaction[]> {
    return Array.from(this.pendingTransactions.values()).filter(
      (tx) => tx.multisigAccountId === multisigAccountId && tx.status === 'pending',
    );
  }

  /** Get all transactions (any status) for a multisig account */
  async getAllTransactions(multisigAccountId: string): Promise<PendingMultisigTransaction[]> {
    return Array.from(this.pendingTransactions.values()).filter(
      (tx) => tx.multisigAccountId === multisigAccountId,
    );
  }

  /** Get a multisig account by ID */
  async getMultisigAccount(accountId: string): Promise<MultisigAccount | null> {
    return this.multisigAccounts.get(accountId) ?? null;
  }

  // ─── Critical Operations ────────────────────────────────────────────────────

  /** Initiate an ownership transfer — requires high-threshold co-signatures */
  async createOwnershipTransferTransaction(
    multisigAccountId: string,
    petId: string,
    newOwnerPublicKey: string,
    createdBy: string,
    transferData: Record<string, unknown> = {},
  ): Promise<PendingMultisigTransaction> {
    const op = Operation.manageData({
      name: `pet_transfer_${petId}`.substring(0, 64),
      value: Buffer.from(
        JSON.stringify({
          petId,
          newOwner: newOwnerPublicKey,
          timestamp: new Date().toISOString(),
          ...transferData,
        }),
      ),
    }) as unknown as StellarOperation;

    return this.createPendingTransaction({
      multisigAccountId,
      operations: [op],
      operationType: 'ownership_transfer',
      description: `Transfer ownership of pet ${petId} to ${newOwnerPublicKey.substring(0, 8)}…`,
      memo: `Pet transfer: ${petId}`.substring(0, 28),
      createdBy,
      metadata: { petId, newOwner: newOwnerPublicKey, ...transferData },
    });
  }

  /** Initiate a record deletion — requires high-threshold co-signatures */
  async createRecordDeletionTransaction(
    multisigAccountId: string,
    recordId: string,
    recordType: string,
    reason: string,
    createdBy: string,
  ): Promise<PendingMultisigTransaction> {
    const op = Operation.manageData({
      name: `del_${recordType}_${recordId}`.substring(0, 64),
      value: Buffer.from(
        JSON.stringify({ recordId, recordType, reason, timestamp: new Date().toISOString() }),
      ),
    }) as unknown as StellarOperation;

    return this.createPendingTransaction({
      multisigAccountId,
      operations: [op],
      operationType: 'record_deletion',
      description: `Delete ${recordType} record ${recordId}`,
      memo: `Delete: ${recordType}/${recordId}`.substring(0, 28),
      createdBy,
      metadata: { recordId, recordType, reason },
    });
  }

  // ─── Signer Management ──────────────────────────────────────────────────────

  /** Add a new co-owner signer — requires medium-threshold approval */
  async addSigner(
    multisigAccountId: string,
    newSigner: {
      publicKey: string;
      weight: number;
      userId?: string;
      name?: string;
      email?: string;
    },
    createdBy: string,
  ): Promise<PendingMultisigTransaction> {
    const op = Operation.setOptions({
      signer: { ed25519PublicKey: newSigner.publicKey, weight: newSigner.weight },
    }) as unknown as StellarOperation;
    return this.createPendingTransaction({
      multisigAccountId,
      operations: [op],
      operationType: 'signer_management',
      description: `Add co-owner: ${newSigner.name ?? newSigner.publicKey.substring(0, 8)}…`,
      createdBy,
      metadata: { action: 'add_signer', signer: newSigner },
    });
  }

  /** Remove a co-owner signer — requires medium-threshold approval */
  async removeSigner(
    multisigAccountId: string,
    signerPublicKey: string,
    createdBy: string,
  ): Promise<PendingMultisigTransaction> {
    const op = Operation.setOptions({
      signer: { ed25519PublicKey: signerPublicKey, weight: 0 },
    }) as unknown as StellarOperation;
    return this.createPendingTransaction({
      multisigAccountId,
      operations: [op],
      operationType: 'signer_management',
      description: `Remove co-owner: ${signerPublicKey.substring(0, 8)}…`,
      createdBy,
      metadata: { action: 'remove_signer', signerPublicKey },
    });
  }

  /**
   * Rotate a co-owner's signing key.
   * Removes the old key and adds the new one atomically in a single transaction.
   * Requires medium-threshold approval from remaining signers.
   */
  async rotateSignerKey(
    multisigAccountId: string,
    request: KeyRotationRequest,
    createdBy: string,
  ): Promise<PendingMultisigTransaction> {
    const removeOp = Operation.setOptions({
      signer: { ed25519PublicKey: request.oldPublicKey, weight: 0 },
    }) as unknown as StellarOperation;

    const multisigAccount = this.multisigAccounts.get(multisigAccountId);
    const oldSigner = multisigAccount?.signers.find((s) => s.publicKey === request.oldPublicKey);
    const weight = oldSigner?.weight ?? 1;

    const addOp = Operation.setOptions({
      signer: { ed25519PublicKey: request.newPublicKey, weight },
    }) as unknown as StellarOperation;

    return this.createPendingTransaction({
      multisigAccountId,
      operations: [removeOp, addOp],
      operationType: 'signer_management',
      description: `Key rotation for user ${request.userId}`,
      createdBy,
      metadata: {
        action: 'key_rotation',
        userId: request.userId,
        oldPublicKey: request.oldPublicKey,
        newPublicKey: request.newPublicKey,
        reason: request.reason,
      },
    });
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private getRequiredSignatures(
    operationType: string,
    thresholds: { low: number; medium: number; high: number },
  ): number {
    switch (operationType) {
      case 'ownership_transfer':
      case 'record_deletion':
        return thresholds.high;
      case 'signer_management':
        return thresholds.medium;
      default:
        return thresholds.low;
    }
  }

  private generateId(): string {
    return CryptoJS.lib.WordArray.random(16).toString();
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const multisigService = new MultisigService();
