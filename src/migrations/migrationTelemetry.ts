import Constants from 'expo-constants';

import { analyticsService } from '../services/analyticsService';
import type { SqliteMigrationOutcome } from './sqliteMigrationRunner';

/**
 * SQLite migration outcome telemetry.
 *
 * Emits one redacted event per migration run that attempted pending
 * migrations: schema versions, a coarse duration bucket, and the recovery
 * result. No row values, SQL text, or parameters are ever included.
 *
 * Fire-and-forget: any failure is swallowed so telemetry can never block
 * migration recovery or app startup.
 */

export type MigrationDurationBucket = '<1s' | '1-5s' | '5-30s' | '>30s';

function bucketMigrationDuration(durationMs: number): MigrationDurationBucket {
  if (durationMs < 1000) return '<1s';
  if (durationMs < 5000) return '1-5s';
  if (durationMs < 30000) return '5-30s';
  return '>30s';
}

function getAppVersion(): string {
  return Constants.expoConfig?.version ?? '1.0.0';
}

export function reportMigrationOutcome(outcome: SqliteMigrationOutcome): void {
  try {
    analyticsService.trackEvent('sqlite_migration_outcome', {
      appVersion: getAppVersion(),
      fromVersion: outcome.fromVersion ?? 'none',
      toVersion: outcome.toVersion,
      failedVersion: outcome.failedVersion ?? 'none',
      durationBucket: bucketMigrationDuration(outcome.durationMs),
      success: outcome.success,
      recovery: outcome.recovery,
    });
  } catch {
    // Telemetry must never affect migration recovery.
  }
}
