import express from 'express';

import { getRedisClient } from './config/redis';
import { getPool } from './src/db';
import adminRouter from './src/routes/admin';

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const PROBE_TIMEOUT_MS = 200;
const UNHEALTHY_THRESHOLD = 3;

const consecutiveFailures = { db: 0, redis: 0, horizon: 0 };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

async function probeDb(): Promise<{ status: string; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await withTimeout(getPool().query('SELECT 1'), PROBE_TIMEOUT_MS);
    consecutiveFailures.db = 0;
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err: unknown) {
    consecutiveFailures.db++;
    return { status: 'error', latencyMs: Date.now() - start, error: (err as Error).message };
  }
}

async function probeRedis(): Promise<{ status: string; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await withTimeout(getRedisClient().ping(), PROBE_TIMEOUT_MS);
    consecutiveFailures.redis = 0;
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err: unknown) {
    consecutiveFailures.redis++;
    return { status: 'error', latencyMs: Date.now() - start, error: (err as Error).message };
  }
}

async function probeHorizon(): Promise<{ status: string; latencyMs: number; error?: string }> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(HORIZON_URL, { signal: controller.signal });
    consecutiveFailures.horizon = 0;
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err: unknown) {
    consecutiveFailures.horizon++;
    return { status: 'error', latencyMs: Date.now() - start, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export function createApp(db: unknown) {
  const app = express();
  app.use(express.json());

  // Inject DB pool so routes can access it via req.app.locals.db
  app.locals.db = db;

  app.get('/health', async (_req, res) => {
    const [db, redis, horizon] = await Promise.all([probeDb(), probeRedis(), probeHorizon()]);

    const anyFailed =
      db.status === 'error' || redis.status === 'error' || horizon.status === 'error';
    const anyUnhealthy =
      consecutiveFailures.db >= UNHEALTHY_THRESHOLD ||
      consecutiveFailures.redis >= UNHEALTHY_THRESHOLD ||
      consecutiveFailures.horizon >= UNHEALTHY_THRESHOLD;

    const status = anyUnhealthy ? 'unhealthy' : anyFailed ? 'degraded' : 'ok';

    res.status(status === 'unhealthy' ? 503 : 200).json({
      status,
      checks: { db, redis, horizon },
    });
  });

  // Routes
  app.use('/admin', adminRouter);

  return app;
}

// Start server only when run directly (not during tests)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  // TODO: replace with your real pg Pool instance
  const app = createApp(null);

  if (process.env.ADD_DELAY_ROUTE) {
    app.get('/delay', async (req, res) => {
      console.log('[Test] Delay route started');
      await new Promise(resolve => setTimeout(resolve, Number(process.env.ADD_DELAY_ROUTE) || 2000));
      console.log('[Test] Delay route finished');
      res.json({ ok: true });
    });
  }

  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  let shuttingDown = false;

  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Shutdown] Received ${signal}, starting graceful shutdown`);
    const start = Date.now();

    // 1. Stop accepting new connections & wait for in-flight requests
    console.log(`[Shutdown] Stopping HTTP server...`);
    
    const serverClosePromise = new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    try {
      // Wait max 30s
      await withTimeout(serverClosePromise, 30000);
      console.log(`[Shutdown] HTTP server closed in ${Date.now() - start}ms`);
    } catch (err: any) {
      console.error(`[Shutdown] HTTP server close error or timeout:`, err.message);
    }

    // 2. Close DB Pool
    try {
      const dbStart = Date.now();
      await getPool().end();
      console.log(`[Shutdown] DB pool closed in ${Date.now() - dbStart}ms`);
    } catch (err: any) {
      console.error(`[Shutdown] Error closing DB pool:`, err.message);
    }

    // 3. Close Redis
    try {
      const redisStart = Date.now();
      await getRedisClient().quit();
      console.log(`[Shutdown] Redis connection closed in ${Date.now() - redisStart}ms`);
    } catch (err: any) {
      console.error(`[Shutdown] Error closing Redis:`, err.message);
    }

    console.log(`[Shutdown] Complete in ${Date.now() - start}ms. Exiting.`);
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
