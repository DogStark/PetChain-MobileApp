/**
 * Logging configuration
 * Issue #99 — Comprehensive Logging Infrastructure
 *
 * All logging behaviour is driven by environment variables so it can be
 * tuned per environment without code changes.
 */

export interface LoggingConfig {
  /** Minimum log level to emit (error | warn | info | http | debug) */
  level: string;
  /** Directory where rotating log files are written */
  logDir: string;
  /** Maximum size of a single log file before rotation (e.g. "20m") */
  maxFileSize: string;
  /** How long to keep combined log files (e.g. "14d") */
  retentionDays: string;
  /** How long to keep error log files (e.g. "30d") */
  errorRetentionDays: string;
  /** Sliding window (ms) used for error-rate spike detection */
  alertWindowMs: number;
  /** Number of errors within the window that triggers an alert */
  alertErrorThreshold: number;
  /** Datadog API key — enables Datadog transport when set */
  datadogApiKey?: string;
  /** Papertrail host — enables Papertrail transport when both host+port are set */
  papertrailHost?: string;
  /** Papertrail port */
  papertrailPort?: number;
  /** Logstash/ELK HTTP URL — enables ELK transport when set */
  logstashUrl?: string;
  /** Service name tag attached to every log entry */
  serviceName: string;
}

function loggingConfig(): LoggingConfig {
  const env = process.env.APP_ENV ?? 'development';

  return {
    level: process.env.LOG_LEVEL ?? (env === 'production' ? 'info' : 'debug'),
    logDir: process.env.LOG_DIR ?? 'logs',
    maxFileSize: process.env.LOG_MAX_SIZE ?? '20m',
    retentionDays: process.env.LOG_RETENTION_DAYS ? `${process.env.LOG_RETENTION_DAYS}d` : '14d',
    errorRetentionDays: process.env.LOG_ERROR_RETENTION_DAYS
      ? `${process.env.LOG_ERROR_RETENTION_DAYS}d`
      : '30d',
    alertWindowMs: Number(process.env.ALERT_WINDOW_MS ?? 60_000),
    alertErrorThreshold: Number(process.env.ALERT_ERROR_THRESHOLD ?? 10),
    datadogApiKey: process.env.DATADOG_API_KEY,
    papertrailHost: process.env.PAPERTRAIL_HOST,
    papertrailPort: process.env.PAPERTRAIL_PORT ? Number(process.env.PAPERTRAIL_PORT) : undefined,
    logstashUrl: process.env.LOGSTASH_URL,
    serviceName: process.env.SERVICE_NAME ?? 'petchain-api',
  };
}

export default loggingConfig();
