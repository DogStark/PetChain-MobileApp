-- Rollback 005: Community Posts, Health Metrics, Emergency Contacts, Sync Queue

DROP TABLE IF EXISTS sync_queue;
DROP TABLE IF EXISTS emergency_contacts;
DROP TABLE IF EXISTS community_posts;
DROP TABLE IF EXISTS health_metrics;

DELETE FROM schema_migrations WHERE version = 5;
