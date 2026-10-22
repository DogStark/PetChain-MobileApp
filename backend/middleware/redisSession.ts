/**
 * Redis-backed session middleware.
 *
 * Replaces any in-process session store with Redis so that every PM2
 * cluster worker shares the same session state.  This is the prerequisite
 * for horizontal scaling: the load balancer can freely route requests to
 * any worker without sticky sessions.
 *
 * Configuration (environment variables):
 *   REDIS_URL          — Redis connection string (default: redis://localhost:6379)
 *   SESSION_SECRET     — Secret used to sign the session ID cookie (required in prod)
 *   SESSION_MAX_AGE_MS — Session TTL in milliseconds (default: 86 400 000 = 24 h)
 *   NODE_ENV           — When 'production', cookie.secure is forced to true
 *
 * Usage:
 *   import { createRedisSessionMiddleware } from '../middleware/redisSession';
 *   app.use(createRedisSessionMiddleware());
 */

import type { RequestHandler } from 'express';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'petchain-dev-session-secret';
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS) || 86_400_000; // 24 h
const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Creates and returns the session middleware.
 *
 * In environments where `express-session` and `connect-redis` are not
 * installed (e.g. during mobile-only development without the backend) the
 * function returns a no-op middleware so the app still starts cleanly.
 */
export function createRedisSessionMiddleware(): RequestHandler {
  try {
    // Dynamic requires allow the module to be optional in the mobile-only context

    const session = require('express-session') as typeof import('express-session');

    const { default: RedisStore } = require('connect-redis') as {
      default: new (options: {
        client: unknown;
        prefix?: string;
      }) => import('express-session').Store;
    };

    const { createClient } = require('redis') as typeof import('redis');

    const redisClient = createClient({ url: REDIS_URL });

    // @ts-expect-error redis client typings differ between redis and ioredis packages.
    redisClient.connect().catch((err: Error) => {
      console.error('[redisSession] Failed to connect to Redis:', err.message);
    });

    redisClient.on('error', (err: Error) => {
      console.error('[redisSession] Redis client error:', err.message);
    });

    const store = new RedisStore({ client: redisClient, prefix: 'petchain:sess:' });

    return session({
      store,
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: 'strict',
        maxAge: SESSION_MAX_AGE_MS,
      },
    });
  } catch {
    // express-session / connect-redis / redis packages not installed — return a no-op
    console.warn(
      '[redisSession] express-session or connect-redis not found; session middleware skipped.',
    );
    return (_req, _res, next) => next();
  }
}
