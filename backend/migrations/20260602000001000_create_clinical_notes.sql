-- Migration: 20260602000001000_create_clinical_notes
-- Description: Add clinical_notes for SOAP-formatted veterinary notes anchored to Stellar

CREATE TYPE IF NOT EXISTS clinical_note_status AS ENUM ('draft', 'anchored');

CREATE TABLE IF NOT EXISTS clinical_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vet_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  subjective TEXT NOT NULL,
  objective TEXT NOT NULL,
  assessment TEXT NOT NULL,
  plan TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  access_controls JSONB NOT NULL DEFAULT '[]'::jsonb,
  stellar_tx_hash TEXT,
  status clinical_note_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinical_notes_pet_id ON clinical_notes (pet_id);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_vet_id ON clinical_notes (vet_id);

CREATE TRIGGER update_clinical_notes_updated_at
  BEFORE UPDATE ON clinical_notes
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- down migration
DROP TRIGGER IF EXISTS update_clinical_notes_updated_at ON clinical_notes;
DROP TABLE IF EXISTS clinical_notes;
DROP TYPE IF EXISTS clinical_note_status;
