-- Migration: 001_create_appointment_waitlist
-- Description: Creates the appointment_waitlist table and supporting indexes.
-- Closes #86
--
-- This migration is written for PostgreSQL. Adjust dialect as needed for
-- MySQL / SQLite (e.g. replace TIMESTAMPTZ with DATETIME, UUID with TEXT).

-- ─── Up ───────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appointment_waitlist (
    -- Primary key
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign keys
    user_id              UUID          NOT NULL,
    vet_id               UUID          NOT NULL,
    pet_id               UUID          NOT NULL,

    -- Preferred appointment window
    preferred_date_start DATE          NOT NULL,
    preferred_date_end   DATE          NOT NULL,

    -- Lifecycle status
    -- Allowed values: WAITING | NOTIFIED | ACCEPTED | EXPIRED | CANCELLED
    status               VARCHAR(20)   NOT NULL DEFAULT 'WAITING',

    -- Queue position (1-based, among WAITING entries for the same vet)
    position             INTEGER       NOT NULL DEFAULT 0,

    -- Estimated wait time in minutes (position × avg slot duration)
    estimated_wait_minutes INTEGER     NOT NULL DEFAULT 0,

    -- Slot-offer timestamps
    notified_at          TIMESTAMPTZ   NULL,
    acceptance_deadline  TIMESTAMPTZ   NULL,   -- notified_at + 15 minutes

    -- Resulting appointment (set when status = ACCEPTED)
    appointment_id       UUID          NULL,

    -- Audit timestamps
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT chk_waitlist_status
        CHECK (status IN ('WAITING', 'NOTIFIED', 'ACCEPTED', 'EXPIRED', 'CANCELLED')),

    CONSTRAINT chk_date_window
        CHECK (preferred_date_end >= preferred_date_start),

    CONSTRAINT chk_position_non_negative
        CHECK (position >= 0),

    CONSTRAINT chk_estimated_wait_non_negative
        CHECK (estimated_wait_minutes >= 0)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Fast lookup of all active entries for a vet (used for queue ordering)
CREATE INDEX IF NOT EXISTS idx_waitlist_vet_status
    ON appointment_waitlist (vet_id, status, created_at ASC);

-- Fast lookup of all entries for a user
CREATE INDEX IF NOT EXISTS idx_waitlist_user_id
    ON appointment_waitlist (user_id, created_at DESC);

-- Quickly find NOTIFIED entries whose acceptance window has expired
CREATE INDEX IF NOT EXISTS idx_waitlist_acceptance_deadline
    ON appointment_waitlist (acceptance_deadline)
    WHERE status = 'NOTIFIED';

-- Unique constraint: a user may only have one active (WAITING or NOTIFIED)
-- entry per vet at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_active_user_vet
    ON appointment_waitlist (user_id, vet_id)
    WHERE status IN ('WAITING', 'NOTIFIED');

-- ─── Trigger: auto-update updated_at ─────────────────────────────────────────

-- Create the trigger function once (idempotent)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_waitlist_updated_at ON appointment_waitlist;

CREATE TRIGGER trg_waitlist_updated_at
    BEFORE UPDATE ON appointment_waitlist
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ─── Down (rollback) ──────────────────────────────────────────────────────────
-- To roll back this migration run the statements below:
--
-- DROP TRIGGER IF EXISTS trg_waitlist_updated_at ON appointment_waitlist;
-- DROP INDEX  IF EXISTS uq_waitlist_active_user_vet;
-- DROP INDEX  IF EXISTS idx_waitlist_acceptance_deadline;
-- DROP INDEX  IF EXISTS idx_waitlist_user_id;
-- DROP INDEX  IF EXISTS idx_waitlist_vet_status;
-- DROP TABLE  IF EXISTS appointment_waitlist;
