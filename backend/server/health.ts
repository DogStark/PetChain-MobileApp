import { getRedisClient } from '../config/redis';
import { getPool } from '../src/db';

export type DependencyStatus = 'ok' | 'degraded' | 'down';
export type OverallStatus = 'ok' | 'degraded' | 'down';

export interface DependencyCheck {
  status: DependencyStatus;
  latency_ms: number;
  last_checked: string;
  error?: string;
}

export interface HealthReport {
  status: OverallStatus;
  timestamp: string;
  dependencies: {
    db: DependencyCheck;
    redis: DependencyCheck;
    stellar: DependencyCheck;
    push: DependencyCheck;
  };
}

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Per-dependency budget so the whole endpoint stays well under 500ms. */
const PROBE_TIMEOUT_MS = Number(process.env.HEALTH_PROBE_TIMEOUT_MS) || 300;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function timed(
  probe: () => Promise<unknown>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<DependencyCheck> {
  const start = Date.now();
  const lastChecked = new Date().toISOString();
  try {
    await withTimeout(Promise.resolve().then(probe), timeoutMs);
    return { status: 'ok', latency_ms: Date.now() - start, last_checked: lastChecked };
  } catch (err: unknown) {
    return {
      status: 'down',
      latency_ms: Date.now() - start,
      last_checked: lastChecked,
      error: (err as Error)?.message ?? 'unknown error',
    };
  }
}

async function probeHttp(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Any HTTP response means the dependency is reachable.
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}

export function probeDb(): Promise<DependencyCheck> {
  return timed(() => getPool().query('SELECT 1'));
}

export function probeRedis(): Promise<DependencyCheck> {
  return timed(() => getRedisClient().ping());
}

export function probeStellar(): Promise<DependencyCheck> {
  return timed(() => probeHttp(HORIZON_URL));
}

export function probePush(): Promise<DependencyCheck> {
  // Expo push has no unauthenticated health route; a HEAD request to the
  // send endpoint is enough to confirm reachability.
  return timed(() => probeHttp(EXPO_PUSH_URL, { method: 'HEAD' }));
}

/**
 * Runs all dependency probes in parallel and derives the overall status.
 * The database is critical: only its failure makes the service `down`.
 */
export async function checkHealth(): Promise<HealthReport> {
  const [db, redis, stellar, push] = await Promise.all([
    probeDb(),
    probeRedis(),
    probeStellar(),
    probePush(),
  ]);

  const nonCriticalDown = [redis, stellar, push].some((d) => d.status !== 'ok');
  const status: OverallStatus = db.status !== 'ok' ? 'down' : nonCriticalDown ? 'degraded' : 'ok';

  return {
    status,
    timestamp: new Date().toISOString(),
    dependencies: { db, redis, stellar, push },
  };
}
