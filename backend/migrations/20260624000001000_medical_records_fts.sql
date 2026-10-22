-- Issue #536: Add full-text search (tsvector) to medical_records table
-- PostgreSQL only. The SQLite path keeps the existing ILIKE fallback.

ALTER TABLE medical_records
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector(
        'english',
        coalesce(title,       '') || ' ' ||
        coalesce(notes,       '') || ' ' ||
        coalesce(diagnosis,   '') || ' ' ||
        coalesce(treatment,   '')
      )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_medical_records_search_vector
  ON medical_records USING GIN (search_vector);
