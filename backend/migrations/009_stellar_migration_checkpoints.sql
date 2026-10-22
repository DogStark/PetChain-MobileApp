-- Migration: stellar_migration_checkpoints
-- Tracks per-record testnet→mainnet migration state for resumable, idempotent execution.

CREATE TABLE IF NOT EXISTS stellar_migration_checkpoints (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_run_id      TEXT NOT NULL,
  record_id             TEXT NOT NULL,
  user_id               TEXT NOT NULL,
  testnet_tx_id         TEXT NOT NULL,
  testnet_record_hash   TEXT NOT NULL,
  mainnet_tx_id         TEXT,
  mainnet_ledger        INTEGER,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','in_progress','verified','failed','skipped')),
  error_message         TEXT,
  attempts              INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (migration_run_id, record_id)
);

CREATE INDEX IF NOT EXISTS idx_smc_run_status   ON stellar_migration_checkpoints (migration_run_id, status);
CREATE INDEX IF NOT EXISTS idx_smc_user_id      ON stellar_migration_checkpoints (user_id);
CREATE INDEX IF NOT EXISTS idx_smc_record_id    ON stellar_migration_checkpoints (record_id);
