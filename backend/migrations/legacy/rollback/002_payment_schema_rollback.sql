-- Rollback 002: Payment Schema

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;

DROP INDEX IF EXISTS idx_subscriptions_status;
DROP INDEX IF EXISTS idx_subscriptions_user_id;
DROP INDEX IF EXISTS idx_payments_user_id;

DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS payments;
