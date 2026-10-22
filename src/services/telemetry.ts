/**
 * Background task execution telemetry.
 *
 * Emits redacted, low-cardinality metrics about background task execution so
 * that success, expiration, OS rejection, and network failure are
 * distinguishable in diagnostics. No health data (pet names, record bodies,
 * tokens, coordinates, document URLs) is ever collected.
 *
 * Retention: events are retained for 30 days in the analytics pipeline.
 * Sampling: follows the existing analytics sampling/opt-out settings; when
 * analytics is disabled or the event is sampled out, nothing is emitted.
 * Telemetry is fire-and-forget and can never block or fail the task itself.
 */

/** Terminal outcome of a background task execution. */
export type BackgroundTaskResult =
  | 'success'
  | 'failure'
  | 'network_failure'
  | 'os_rejected'
  | 'os_expired';

/** Coarse duration buckets keep cardinality low and avoid timing fingerprints. */
export type DurationBucket = '<1s' | '1-5s' | '5-30s' | '30s-2m' | '>2m';

/**
 * Redacted telemetry event schema. Only these fields may be emitted; callers
 * must never attach task payloads or identifiers.
 */
export interface BackgroundTaskTelemetryEvent {
  /** Stable, non-identifying task identifier (e.g. 'sync', 'reminders'). */
  taskName: string;
  /** App version string, e.g. '1.4.2'. */
  appVersion: string;
  /** Coarse execution duration bucket. */
  durationBucket: DurationBucket;
  /** Terminal outcome for this execution. */
  result: BackgroundTaskResult;
  /** Number of retries attempted before the terminal outcome. */
  retryCount: number;
}

/** Fields that must never appear in a telemetry event. */
export const FORBIDDEN_TELEMETRY_FIELDS = [
  'petName',
  'petNames',
  'recordBody',
  'recordBodies',
  'token',
  'tokens',
  'accessToken',
  'refreshToken',
  'coordinates',
  'latitude',
  'longitude',
  'documentUrl',
  'documentUrls',
  'url',
] as const;

/** Minimal analytics surface this module depends on. */
export interface AnalyticsSettings {
  /** Whether analytics collection is enabled (opt-out respected). */
  enabled: boolean;
  /** Sampling rate in [0, 1]; 1 means always emit. */
  sampleRate: number;
}

/** Sink that receives redacted events. Must never throw. */
export type TelemetrySink = (event: BackgroundTaskTelemetryEvent) => void;

const DEFAULT_SETTINGS: AnalyticsSettings = { enabled: true, sampleRate: 1 };

let settings: AnalyticsSettings = DEFAULT_SETTINGS;
let sink: TelemetrySink | null = null;

/** Wire up analytics settings and the event sink. */
export function configureBackgroundTaskTelemetry(
  nextSettings: AnalyticsSettings,
  nextSink: TelemetrySink,
): void {
  settings = nextSettings;
  sink = nextSink;
}

/** Map a raw duration in milliseconds to a coarse bucket. */
export function toDurationBucket(durationMs: number): DurationBucket {
  if (durationMs < 1000) return '<1s';
  if (durationMs < 5000) return '1-5s';
  if (durationMs < 30000) return '5-30s';
  if (durationMs < 120000) return '30s-2m';
  return '>2m';
}

/**
 * Strip any forbidden fields from an event, keeping only the allowed schema.
 * Defensive: guarantees no health data leaks even if a caller passes extra keys.
 */
export function redactEvent(
  event: BackgroundTaskTelemetryEvent,
): BackgroundTaskTelemetryEvent {
  return {
    taskName: event.taskName,
    appVersion: event.appVersion,
    durationBucket: event.durationBucket,
    result: event.result,
    retryCount: event.retryCount,
  };
}

/**
 * Emit a single terminal telemetry event. Fire-and-forget: never throws and
 * never blocks the calling task. Respects analytics opt-out and sampling.
 */
export function emitBackgroundTaskTelemetry(
  event: BackgroundTaskTelemetryEvent,
): void {
  try {
    if (!settings.enabled) return;
    if (settings.sampleRate <= 0) return;
    if (settings.sampleRate < 1 && Math.random() >= settings.sampleRate) return;
    if (!sink) return;
    sink(redactEvent(event));
  } catch {
    // Telemetry must never affect task execution.
  }
}

/**
 * Tracks a single background task execution and guarantees exactly one
 * terminal outcome is reported. If the task never reports a result (e.g. the
 * OS expires it), an explicit 'os_expired' outcome is emitted on finalize.
 */
export class BackgroundTaskRun {
  private readonly startedAt: number;
  private readonly taskName: string;
  private readonly appVersion: string;
  private retryCount = 0;
  private reported = false;

  constructor(taskName: string, appVersion: string) {
    this.taskName = taskName;
    this.appVersion = appVersion;
    this.startedAt = Date.now();
  }

  /** Record a retry attempt before the terminal outcome. */
  recordRetry(): void {
    this.retryCount += 1;
  }

  /** Report the terminal outcome. Subsequent calls are ignored. */
  finish(result: BackgroundTaskResult): void {
    if (this.reported) return;
    this.reported = true;
    emitBackgroundTaskTelemetry({
      taskName: this.taskName,
      appVersion: this.appVersion,
      durationBucket: toDurationBucket(Date.now() - this.startedAt),
      result,
      retryCount: this.retryCount,
    });
  }

  /**
   * Finalize the run. If no terminal outcome was reported, emit an explicit
   * 'os_expired' outcome so every supported task reports exactly one result.
   */
  finalize(): void {
    if (this.reported) return;
    this.finish('os_expired');
  }
}
