/**
 * Integration test: pool exhaustion fails fast after connectionTimeoutMillis.
 * #596
 */
import { Pool } from 'pg';

const CONNECTION_TIMEOUT_MS = 200; // short for test speed

describe('PostgreSQL pool exhaustion', () => {
  it('rejects new requests fast (not hang) when pool is exhausted', async () => {
    const pool = new Pool({
      connectionString:
        process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/petchain',
      max: 2,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: 1000,
    });

    // Grab all connections and hold them
    let clientA: import('pg').PoolClient | null = null;
    let clientB: import('pg').PoolClient | null = null;

    try {
      clientA = await pool.connect();
      clientB = await pool.connect();

      const start = Date.now();
      await expect(pool.connect()).rejects.toThrow();
      const elapsed = Date.now() - start;

      // Should fail within 2× the timeout, not hang
      expect(elapsed).toBeLessThan(CONNECTION_TIMEOUT_MS * 2 + 100);
    } finally {
      clientA?.release();
      clientB?.release();
      await pool.end();
    }
  });
});
