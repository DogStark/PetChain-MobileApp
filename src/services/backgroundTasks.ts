import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { analytics } from './analytics';
import { logger } from '../utils/logger';

/**
 * Background task execution telemetry.
 *
 * Emits redacted, non-identifying metrics about background task execution so
 * that sync and reminder failures can be diagnosed. No pet names, record
 * bodies, tokens, coordinates, or document URLs are ever included.
 *
 * Retention: events are retained by the analytics backend for 90 days.
 * Sampling: events are sampled at 100% for failures and 10% for successes,
 * and are suppressed entirely when the user has opted out of analytics.
 */

export type BackgroundTaskResult =
  | 'success'
  | 'network_failure'
  | 'os_rejected'
  | 'os_expired'
  | 'error';

export type DurationBucket = '<1s' | '1-5s' | '5-30s' | '30-60s' | '>60s';

export interface BackgroundTaskTelemetryEvent {
  /** Logical name of the background task (e.g. "sync", "reminders"). */
  taskName: string;
  /** App version string, used to correlate regressions with releases. */
  appVersion: string;
  /** Coarse execution duration bucket; never a raw timestamp. */
  durationBucket: DurationBucket;
  /** Terminal outcome for this execution. */
  result: BackgroundTaskResult;
  /** Number of retries attempted before reaching the terminal outcome. */
  retryCount: number;
  /** Platform the task ran on. */
  platform: 'ios' | 'android' | 'web' | 'unknown';
}

const SUCCESS_SAMPLE_RATE = 0.1;

function bucketDuration(durationMs: number): DurationBucket {
  if (durationMs < 1000) return '<1s';
  if (durationMs < 5000) return '1-5s';
  if (durationMs < 30000) return '5-30s';
  if (durationMs < 60000) return '30-60s';
  return '>60s';
}

function currentPlatform(): BackgroundTaskTelemetryEvent['platform'] {
  if (Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web') {
    return Platform.OS;
  }
  return 'unknown';
}

/**
 * Emit a single terminal telemetry event for a background task execution.
 *
 * This is intentionally fire-and-forget: telemetry must never block or fail
 * the task itself, so all errors are swallowed after logging.
 */
export function reportBackgroundTaskOutcome(
  taskName: string,
  result: BackgroundTaskResult,
  durationMs: number,
  retryCount = 0,
): void {
  try {
    if (!analytics.isEnabled()) {
      return;
    }

    if (result === 'success' && Math.random() >= SUCCESS_SAMPLE_RATE) {
      return;
    }

    const event: BackgroundTaskTelemetryEvent = {
      taskName,
      appVersion: Application.nativeApplicationVersion ?? 'unknown',
      durationBucket: bucketDuration(durationMs),
      result,
      retryCount,
      platform: currentPlatform(),
    };

    analytics.track('background_task_outcome', event);
  } catch (error) {
    logger.warn('Failed to report background task telemetry', error);
  }
}

/**
 * Wrap a background task handler so that exactly one terminal outcome is
 * reported per execution, including explicit OS-expired outcomes.
 */
export function withBackgroundTaskTelemetry<T>(
  taskName: string,
  handler: () => Promise<T>,
): () => Promise<T> {
  return async () => {
    const startedAt = Date.now();
    let retryCount = 0;

    try {
      const value = await handler();
      reportBackgroundTaskOutcome(taskName, 'success', Date.now() - startedAt, retryCount);
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isNetworkFailure = /network|offline|timeout/i.test(message);
      const isOsRejection = /reject|denied|unavailable/i.test(message);
      const isOsExpired = /expired|BackgroundFetchResult\.Failed/i.test(message);

      if (isOsExpired) {
        reportBackgroundTaskOutcome(taskName, 'os_expired', Date.now() - startedAt, retryCount);
      } else if (isOsRejection) {
        reportBackgroundTaskOutcome(taskName, 'os_rejected', Date.now() - startedAt, retryCount);
      } else if (isNetworkFailure) {
        reportBackgroundTaskOutcome(taskName, 'network_failure', Date.now() - startedAt, retryCount);
      } else {
        reportBackgroundTaskOutcome(taskName, 'error', Date.now() - startedAt, retryCount);
      }

      throw error;
    }
  };
}

/**
 * Register a background task with telemetry instrumentation.
 */
export async function registerBackgroundTask(
  taskName: string,
  handler: () => Promise<BackgroundFetch.BackgroundFetchResult>,
): Promise<void> {
  const instrumented = withBackgroundTaskTelemetry(taskName, handler);

  TaskManager.defineTask(taskName, async () => {
    try {
      return await instrumented();
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });

  await BackgroundFetch.registerTaskAsync(taskName, {
    minimumInterval: 15 * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}
