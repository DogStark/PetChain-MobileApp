-- Migration: 20260628000001_common_query_indexes
-- Description: Composite indexes for common query patterns (#1390)
--   * appointments by pet, ordered/filtered by date
--   * medical records by vet, ordered/filtered by visit date
--   * medications by pet, filtered by active flag
--
-- Verify index usage after applying (expect "Index Scan" / "Bitmap Index Scan"
-- on the new indexes instead of "Seq Scan"):
--   EXPLAIN ANALYZE SELECT * FROM appointments
--     WHERE pet_id = '<pet uuid>' AND date >= CURRENT_DATE ORDER BY date;
--   EXPLAIN ANALYZE SELECT * FROM medical_records
--     WHERE vet_id = '<vet uuid>' ORDER BY visit_date DESC LIMIT 20;
--   EXPLAIN ANALYZE SELECT * FROM medications
--     WHERE pet_id = '<pet uuid>' AND active = TRUE;

-- up migration
CREATE INDEX IF NOT EXISTS idx_appointments_pet_id_date
  ON appointments (pet_id, date);

CREATE INDEX IF NOT EXISTS idx_medical_records_vet_id_visit_date
  ON medical_records (vet_id, visit_date);

CREATE INDEX IF NOT EXISTS idx_medications_pet_id_active
  ON medications (pet_id, active);

-- down migration
DROP INDEX IF EXISTS idx_medications_pet_id_active;
DROP INDEX IF EXISTS idx_medical_records_vet_id_visit_date;
DROP INDEX IF EXISTS idx_appointments_pet_id_date;
