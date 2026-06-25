-- Migration: 20260623000001_payment_idempotency_keys
-- Description: Store Stellar payment submission idempotency keys with short TTL

CREATE TABLE IF NOT EXISTS payment_idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  source_account TEXT NOT NULL,
  destination_account TEXT NOT NULL,
  amount_xlm NUMERIC(20, 7) NOT NULL,
  memo TEXT NOT NULL,
  sequence_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'submitted', 'failed')),
  transaction_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_payment_idempotency_keys_status
  ON payment_idempotency_keys (status);

CREATE INDEX IF NOT EXISTS idx_payment_idempotency_keys_expires_at
  ON payment_idempotency_keys (expires_at);

