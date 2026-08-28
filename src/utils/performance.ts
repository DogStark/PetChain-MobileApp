import * as Sentry from '@sentry/react-native';

const SLOW_SQL_THRESHOLD_MS = 200; // flag queries slower than this

export function initPerformance(dsn?: string) {
  try {
    if (!(Sentry as any).getCurrentHub?.()) return;
    Sentry.init({ dsn, tracesSampleRate: 0.2 });
  } catch (e) {
    // fail silently in init

    console.warn('Sentry init failed', e);
  }
}

export function startSpan(name: string) {
  try {
    const tracer = (Sentry as any).getCurrentHub?.().getScope()?.getTransaction?.() as
      | any
      | undefined;

    if (tracer) return tracer.startChild({ op: 'task', description: name });

    return ((Sentry as any).startTransaction ?? (Sentry as any).startSpan)({ name });
  } catch {
    return undefined;
  }
}

export function finishSpan(span?: { finish: () => void }) {
  try {
    span?.finish();
  } catch {
    // ignore
  }
}

export function recordMetric(name: string, value: number, tags?: Record<string, unknown>) {
  try {
    Sentry.addBreadcrumb({ category: 'metric', message: `${name}:${value}`, data: tags });
    // Also attach as measurement on the active transaction if any
    const txn = (Sentry as any).getCurrentHub?.().getScope()?.getTransaction?.();
    if (txn && typeof txn.setMeasurement === 'function') {
      txn.setMeasurement(name, value);
    }
  } catch {
    // ignore
  }
}

export function recordApiTiming(
  url: string | undefined,
  method: string | undefined,
  durationMs: number,
  status?: number,
) {
  recordMetric('api.duration_ms', durationMs, { url, method, status });
}

export function recordSqlTiming(query: string, durationMs: number) {
  recordMetric('sql.duration_ms', durationMs, { query });
  if (durationMs >= SLOW_SQL_THRESHOLD_MS) {
    Sentry.captureMessage(`Slow SQL query (${durationMs}ms)`, {
      level: 'warning',
      tags: { slow_sql: 'true' },
      extra: { query, durationMs },
    });
  }
}

export function recordStellarTiming(txId: string, submissionMs?: number, confirmationMs?: number) {
  if (submissionMs != null) recordMetric('stellar.submission_ms', submissionMs, { txId });
  if (confirmationMs != null) recordMetric('stellar.confirmation_ms', confirmationMs, { txId });
}

export function setPerformanceBudget(name: string, thresholdMs: number) {
  // store as breadcrumb so Sentry can be queried; alerting rules should be configured on Sentry side
  Sentry.addBreadcrumb({ category: 'performance.budget', message: `${name}:${thresholdMs}` });
}

export default {
  initPerformance,
  startSpan,
  finishSpan,
  recordMetric,
  recordApiTiming,
  recordSqlTiming,
  recordStellarTiming,
  setPerformanceBudget,
};
