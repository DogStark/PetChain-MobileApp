import Redis from 'ioredis';

let redisClient: Redis | null = null;
let isReady = false;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      },
    });

    redisClient.on('connect', () => {
      isReady = true;
    });
    redisClient.on('error', (_err) => {
      isReady = false;
    });
  }
  return redisClient;
}

export function isRedisReady(): boolean {
  return isReady;
}

export const REDIS_KEY_PREFIX = 'petchain:';

export const CACHE_TTL = {
  PET: 3600, // 1 hour
  VET: 21600, // 6 hours
  BREED: 86400, // 24 hours
} as const;
