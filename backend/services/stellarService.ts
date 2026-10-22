import crypto from 'crypto';

import * as StellarSdk from '@stellar/stellar-sdk';

import config from '../config';
import { query } from '../src/db';

export type StellarAnchorStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

export interface AnchorRecordInput {
  recordId: string;
  payload: unknown;
  sourceSecret?: string;
  network?: 'testnet' | 'mainnet';
}

export interface AnchorResult {
  recordId: string;
  recordHash: string;
  transactionId: string;
  ledgerSequence?: number;
  status: StellarAnchorStatus;
}

export class StellarAnchorService {
  private readonly maxRetries: number;

  constructor(maxRetries = 3) {
    this.maxRetries = maxRetries;
  }

  hashPayload(payload: unknown): string {
    return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
  }

  async anchorRecord(input: AnchorRecordInput): Promise<AnchorResult> {
    const recordHash = this.hashPayload(input.payload);
    const network = input.network ?? (config.isProd ? 'mainnet' : 'testnet');
    const server = this.getServer(network);
    const sourceSecret = input.sourceSecret ?? process.env.STELLAR_SOURCE_SECRET;

    if (!sourceSecret) {
      const transactionId = `pending:${input.recordId}:${recordHash}`;
      await this.persistTransaction(
        input.recordId,
        recordHash,
        transactionId,
        undefined,
        'pending',
        network,
      );
      return { recordId: input.recordId, recordHash, transactionId, status: 'pending' };
    }

    const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    let lastError: unknown;

    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try {
        const account = await server.loadAccount(keypair.publicKey());
        const fee = String(Number(await server.fetchBaseFee()) * (attempt + 1));
        const transaction = new StellarSdk.TransactionBuilder(account, {
          fee,
          networkPassphrase: this.getNetworkPassphrase(network),
        })
          .addOperation(
            StellarSdk.Operation.manageData({
              name: `record:${input.recordId}`.slice(0, 64),
              value: recordHash,
            }),
          )
          .setTimeout(60)
          .build();

        transaction.sign(keypair);
        const submitted = await server.submitTransaction(transaction);
        const transactionId = submitted.hash;
        const ledgerSequence = submitted.ledger;
        await this.persistTransaction(
          input.recordId,
          recordHash,
          transactionId,
          ledgerSequence,
          'submitted',
          network,
        );
        return {
          recordId: input.recordId,
          recordHash,
          transactionId,
          ledgerSequence,
          status: 'submitted',
        };
      } catch (error) {
        lastError = error;
        await wait(2 ** attempt * 250);
      }
    }

    const transactionId = `failed:${input.recordId}:${Date.now()}`;
    await this.persistTransaction(
      input.recordId,
      recordHash,
      transactionId,
      undefined,
      'failed',
      network,
    );
    throw lastError instanceof Error ? lastError : new Error('Stellar transaction failed');
  }

  async verifyRecord(
    recordId: string,
    payload: unknown,
  ): Promise<{ verified: boolean; recordHash: string }> {
    const recordHash = this.hashPayload(payload);
    const status = await this.getTransactionStatus(recordId);
    return {
      verified: status?.recordHash === recordHash && status.status !== 'failed',
      recordHash,
    };
  }

  async getTransactionStatus(recordId: string): Promise<AnchorResult | null> {
    try {
      const result = await query(
        `SELECT record_id, record_hash, transaction_id, ledger_sequence, status
         FROM blockchain_transactions
         WHERE record_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [recordId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        recordId: row.record_id,
        recordHash: row.record_hash,
        transactionId: row.transaction_id,
        ledgerSequence: row.ledger_sequence,
        status: row.status,
      };
    } catch {
      return null;
    }
  }

  private getServer(network: 'testnet' | 'mainnet'): StellarSdk.Horizon.Server {
    return new StellarSdk.Horizon.Server(
      network === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org',
    );
  }

  private getNetworkPassphrase(network: 'testnet' | 'mainnet'): string {
    return network === 'mainnet' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
  }

  private async persistTransaction(
    recordId: string,
    recordHash: string,
    transactionId: string,
    ledgerSequence: number | undefined,
    status: StellarAnchorStatus,
    network: string,
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO blockchain_transactions
          (id, record_id, record_hash, transaction_id, ledger_sequence, status, network, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [recordId, recordHash, transactionId, ledgerSequence ?? null, status, network],
      );
    } catch {
      return;
    }
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const stellarAnchorService = new StellarAnchorService();
export default stellarAnchorService;
