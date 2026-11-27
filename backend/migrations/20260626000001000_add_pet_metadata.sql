-- Migration: Add metadata JSONB column to pets table
-- Description: Adds a flexible metadata column to store pet-specific configurations like step goals.
-- Also creates pet_metadata_history to version metadata changes for the audit trail.

-- up migration
ALTER TABLE pets ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

CREATE TABLE IF NOT EXISTS pet_metadata_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    before JSONB,
    after JSONB,
    patch JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pet_metadata_history_pet_created
    ON pet_metadata_history (pet_id, created_at DESC);

-- down migration
DROP INDEX IF EXISTS idx_pet_metadata_history_pet_created;
DROP TABLE IF EXISTS pet_metadata_history;
ALTER TABLE pets DROP COLUMN IF EXISTS metadata;