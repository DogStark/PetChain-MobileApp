import crypto from 'crypto';

import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { query } from '../src/db';

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const RECEIVING_SECRET = process.env.STELLAR_RECEIVING_SECRET || '';
const PREMIUM_PRICE_XLM = parseFloat(process.env.PREMIUM_PRICE_XLM || '10');
const OVERPAYMENT_TOLERANCE = 0.001;
const REFUND_MEMO = 'PetChain refund';

const server = new Horizon.Server(HORIZON_URL);

export interface PaymentIntent {
  transactionId: string;
  destination: string;
  amountXlm: number;
  memo: string;
  expiresAt: Date;
}

export type PaymentStatus = 'confirmed' | 'partial' | 'overpaid' | 'expired';

export type PaymentIdempotencyStatus = 'processing' | 'submitted' | 'failed';

export interface PaymentResult {
  status: PaymentStatus;
  amountReceived: number;
  txHash: string;
}

export interface PaymentIdempotencyRecord {
  idempotencyKey: string;
  sourceAccount: string;
  destinationAccount: string;
  amountXlm: string;
  memo: string;
  sequenceNumber: string;
  status: PaymentIdempotencyStatus;
  transactionHash?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

function receivingKeypair(): Keypair {
  if (!RECEIVING_SECRET) {
    throw new Error('STELLAR_RECEIVING_SECRET is required');
  }

  return Keypair.fromSecret(RECEIVING_SECRET);
}

function nextSequenceNumber(sequence: string): string {
  return (BigInt(sequence) + 1n).toString();
}

function buildIdempotencyKey(input: {
  sourceAccount: string;
  destinationAccount: string;
  amountXlm: string;
  memo: string;
  sequenceNumber: string;
}): string {
  return crypto
    .createHash('sha256')
    .update(
      [
        input.sourceAccount.trim(),
        input.destinationAccount.trim(),
        input.amountXlm.trim(),
        input.memo.trim(),
        input.sequenceNumber.trim(),
      ].join('|'),
    )
    .digest('hex');
}

async function cleanupExpiredIdempotencyKeys(now = new Date()): Promise<number> {
  const result = await query(
    `DELETE FROM payment_idempotency_keys
     WHERE expires_at <= $1`,
    [now.toISOString()],
  );
  return result.rowCount ?? 0;
}

async function reserveIdempotencyKey(record: {
  idempotencyKey: string;
  sourceAccount: string;
  destinationAccount: string;
  amountXlm: string;
  memo: string;
  sequenceNumber: string;
}): Promise<{
  inserted: boolean;
  existing?: PaymentIdempotencyRecord | null;
}> {
  const insertResult = await query(
    `INSERT INTO payment_idempotency_keys
      (idempotency_key, source_account, destination_account, amount_xlm, memo, sequence_number, status, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'processing', NOW() + INTERVAL '24 hours', NOW(), NOW())
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING idempotency_key`,
    [
      record.idempotencyKey,
      record.sourceAccount,
      record.destinationAccount,
      record.amountXlm,
      record.memo,
      record.sequenceNumber,
    ],
  );

  if (insertResult.rowCount && insertResult.rowCount > 0) {
    return { inserted: true };
  }

  const existingResult = await query(
    `SELECT
       idempotency_key AS "idempotencyKey",
       source_account AS "sourceAccount",
       destination_account AS "destinationAccount",
       amount_xlm AS "amountXlm",
       memo,
       sequence_number AS "sequenceNumber",
       status,
       transaction_hash AS "transactionHash",
       created_at AS "createdAt",
       updated_at AS "updatedAt",
       expires_at AS "expiresAt"
     FROM payment_idempotency_keys
     WHERE idempotency_key = $1
     LIMIT 1`,
    [record.idempotencyKey],
  );

  return { inserted: false, existing: existingResult.rows[0] ?? null };
}

async function markIdempotencySubmitted(
  idempotencyKey: string,
  transactionHash: string,
): Promise<void> {
  await query(
    `UPDATE payment_idempotency_keys
     SET status = 'submitted',
         transaction_hash = $2,
         updated_at = NOW()
     WHERE idempotency_key = $1`,
    [idempotencyKey, transactionHash],
  );
}

export async function cleanupExpiredPaymentIdempotencyKeys(now = new Date()): Promise<number> {
  return cleanupExpiredIdempotencyKeys(now);
}

export function startPaymentIdempotencyCleanupJob(
  intervalMs = 60 * 60 * 1000,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    cleanupExpiredIdempotencyKeys().catch(() => undefined);
  }, intervalMs) as unknown as NodeJS.Timeout;

  timer.unref();
  return timer;
}

export function createPaymentIntent(userId: string): PaymentIntent {
  const transactionId = `PET-${userId}-${Date.now()}`;
  const destination = receivingKeypair().publicKey();

  return {
    transactionId,
    destination,
    amountXlm: PREMIUM_PRICE_XLM,
    memo: transactionId.slice(0, 28),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  };
}

export function streamPayment(
  intent: PaymentIntent,
  onResult: (result: PaymentResult) => void,
  onError?: (error: Error) => void,
): () => void {
  const destination = receivingKeypair().publicKey();

  const close = server
    .payments()
    .forAccount(destination)
    .cursor('now')
    .stream({
      onmessage: async (payment: any) => {
        try {
          if (payment.type !== 'payment') return;
          if (payment.asset_type !== 'native') return;
          if (payment.to !== destination) return;

          const transaction = await payment.transaction();
          if (transaction.memo !== intent.memo) return;

          const received = parseFloat(payment.amount);
          const expected = intent.amountXlm;
          const status =
            received > expected + OVERPAYMENT_TOLERANCE
              ? 'overpaid'
              : received >= expected - OVERPAYMENT_TOLERANCE
                ? 'confirmed'
                : 'partial';

          onResult({ status, amountReceived: received, txHash: payment.transaction_hash });
          close();
        } catch (error) {
          onError?.(
            error instanceof Error ? error : new Error('Failed to process Stellar payment'),
          );
        }
      },
      onerror: (error: MessageEvent) => {
        onError?.(new Error(String(error?.data ?? 'Stellar stream error')));
      },
    });

  return close;
}

export async function processRefund(
  destinationPublicKey: string,
  amountXlm: string,
): Promise<string> {
  const sourceKeypair = receivingKeypair();
  const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());
  const sourceAccountId = sourceKeypair.publicKey();
  const destinationAccount = destinationPublicKey.trim();
  const memo = REFUND_MEMO;
  const sequenceNumber = nextSequenceNumber((sourceAccount as { sequence: string }).sequence);
  const idempotencyKey = buildIdempotencyKey({
    sourceAccount: sourceAccountId,
    destinationAccount,
    amountXlm,
    memo,
    sequenceNumber,
  });

  await cleanupExpiredIdempotencyKeys();

  const reservation = await reserveIdempotencyKey({
    idempotencyKey,
    sourceAccount: sourceAccountId,
    destinationAccount,
    amountXlm: amountXlm.trim(),
    memo,
    sequenceNumber,
  });

  if (!reservation.inserted) {
    if (reservation.existing?.status === 'submitted' && reservation.existing.transactionHash) {
      return reservation.existing.transactionHash;
    }

    throw new Error('Payment submission already in progress');
  }

  const tx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: destinationAccount,
        asset: Asset.native(),
        amount: amountXlm,
      }),
    )
    .addMemo(Memo.text(memo))
    .setTimeout(30)
    .build();

  tx.sign(sourceKeypair);
  try {
    const result = await server.submitTransaction(tx);
    await markIdempotencySubmitted(idempotencyKey, result.hash);
    return result.hash;
  } catch (error) {
    await query(
      `UPDATE payment_idempotency_keys
       SET status = 'failed',
           updated_at = NOW()
       WHERE idempotency_key = $1`,
      [idempotencyKey],
    ).catch(() => undefined);
    throw error;
  }
}
