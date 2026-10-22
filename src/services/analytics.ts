import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

/**
 * Background task execution telemetry.
 *
 * Emits redacted, non-identifying metrics about background task execution so
 * that sync/reminder failures (expiration, OS rejection, network failure) can
 * be diagnosed. No pet names, record bodies, tokens, coordinates, or document
 * URLs are ever included.
 *
 * Retention: events are retained for 30 days in the analytics backend.
 * Sampling: follows the existing analytics opt-out/sampling settings; when
 * analytics is disabled no events are emitted. Telemetry is fire-and-forget
 * and can never block or fail the task itself.
 */

export type BackgroundTaskResult =
  | 'success'
  | 'failure'
  | 'network_error'
  | 'os_rejected'
  | 'os_expired';

export type DurationBucket = '<1s' | '1-5s' | '5-30s' | '30s-2m' | '>2m';

export interface BackgroundTaskTelemetryEvent {
  event: 'background_task';
  taskName: string;
  appVersion: string;
  durationBucket: DurationBucket;
  result: BackgroundTaskResult;
  retryCount: number;
  platform: string;
}

/** Fields that must never appear in a telemetry event. */
export const FORBIDDEN_TELEMETRY_FIELDS = [
  'petName',
  'petNames',
  'recordBody',
  'recordBodies',
  'token',
  'accessToken',
  'refreshToken',
  'coordinates',
  'latitude',
  'longitude',
  'documentUrl',
  'documentUrls',
  'url',
] as const;

const DURATION_BUCKETS: Array<{ maxMs: number; bucket: DurationBucket }> = [
  { maxMs: 1000, bucket: '<1s' },
  { maxMs: 5000, bucket: '1-5s' },
  { maxMs: 30000, bucket: '5-30s' },
  { maxMs: 120000, bucket: '30s-2m' },
];

export function bucketDuration(durationMs: number): DurationBucket {
  for (const { maxMs, bucket } of DURATION_BUCKETS) {
    if (durationMs < maxMs) {
      return bucket;
    }
  }
  return '>2m';
}

function getAppVersion(): string {
  return Constants.expoConfig?.version ?? Constants.manifest2?.extra?.expoClient?.version ?? 'unknown';
}

/**
 * Build a redacted telemetry event. Only the whitelisted fields below are
 * copied, so any extra payload passed in is dropped.
 */
export function buildBackgroundTaskEvent(params: {
  taskName: string;
  durationMs: number;
  result: BackgroundTaskResult;
  retryCount?: number;
}): BackgroundTaskTelemetryEvent {
  return {
    event: 'background_task',
    taskName: params.taskName,
    appVersion: getAppVersion(),
    durationBucket: bucketDuration(params.durationMs),
    result: params.result,
    retryCount: params.retryCount ?? 0,
    platform: Platform.OS,
  };
}

/**
 * Emit a background task telemetry event. Fire-and-forget: any error is
 * swallowed so telemetry can never block or fail the task itself.
 */
export function trackBackgroundTask(params: {
  taskName: string;
  durationMs: number;
  result: BackgroundTaskResult;
  retryCount?: number;
}): void {
  try {
    const event = buildBackgroundTaskEvent(params);
    // Existing analytics pipeline handles opt-out and sampling.
    void track(event.event, event);
  } catch {
    // Never let telemetry affect task execution.
  }
}

/**
 * Wrap a background task handler so it reports exactly one terminal outcome
 * (or an explicit OS-expired outcome) without leaking payload data.
 */
export function withBackgroundTaskTelemetry<T>(
  taskName: string,
  handler: () => Promise<T>,
): () => Promise<T> {
  return async () => {
    const startedAt = Date.now();
    let retryCount = 0;
    try {
      const result = await handler();
      trackBackgroundTask({
        taskName,
        durationMs: Date.now() - startedAt,
        result: 'success',
        retryCount,
      });
      return result;
    } catch (error) {
      const isNetworkError =
        error instanceof Error && /network|timeout|offline/i.test(error.message);
      trackBackgroundTask({
        taskName,
        durationMs: Date.now() - startedAt,
        result: isNetworkError ? 'network_error' : 'failure',
        retryCount,
      });
      throw error;
    }
  };
}

/**
 * Report an explicit OS-expired outcome for a background task.
 */
export function trackBackgroundTaskExpired(taskName: string, durationMs = 0): void {
  trackBackgroundTask({ taskName, durationMs, result: 'os_expired' });
}

/**
 * Report an OS rejection when registering a background task.
 */
export function trackBackgroundTaskRejected(taskName: string): void {
  trackBackgroundTask({ taskName, durationMs: 0, result: 'os_rejected' });
}

/**
 * Register a background task with telemetry on both the registration and
 * completion paths. Registration failures are reported as os_rejected.
 */
export async function registerBackgroundTaskWithTelemetry(
  taskName: string,
  options: BackgroundFetch.BackgroundFetchOptions,
): Promise<void> {
  try {
    await BackgroundFetch.registerTaskAsync(taskName, options);
  } catch {
    trackBackgroundTaskRejected(taskName);
    throw new Error(`Failed to register background task: ${taskName}`);
  }
}

/**
 * Define a background task with telemetry wrapping its handler.
 */
export function defineBackgroundTaskWithTelemetry<T>(
  taskName: string,
  handler: () => Promise<T>,
): void {
  TaskManager.defineTask(taskName, withBackgroundTaskTelemetry(taskName, handler));
}

// Placeholder for the existing analytics transport. Replaced by the real
// implementation in the analytics module; kept here so this file is
// self-contained for the telemetry helpers above.
declare function track(event: string, properties: Record<string, unknown>): Promise<void>;
