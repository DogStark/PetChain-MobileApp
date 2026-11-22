/**
 * CLI entry point for the inactive-account data retention policy (#1400).
 * Usage: ts-node backend/scripts/dataRetention.ts
 * Thresholds come from RETENTION_* environment variables.
 */
import { getRetentionConfig, runRetentionPolicy } from '../services/dataRetentionService';

if (require.main === module) {
  const config = getRetentionConfig();
  runRetentionPolicy(new Date(), config)
    .then((result) => {
      console.log(JSON.stringify({ config, result }, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
