-- Migration: Add metadata JSONB column to pets table
-- Description: Adds a flexible metadata column to store pet-specific configurations like step goals.

-- up migration
ALTER TABLE pets ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- down migration
ALTER TABLE pets DROP COLUMN IF EXISTS metadata;
