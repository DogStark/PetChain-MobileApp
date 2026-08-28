import { Pool } from 'pg';

import config from '../../../config';
import { getPool, query } from '../index';

jest.mock('pg', () => {
  const mPool = {
    on: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

describe('Database Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize the pool with correct configuration', () => {
    const pool = getPool();
    expect(Pool).toHaveBeenCalledWith({
      connectionString: config.database.url,
      max: config.database.poolSize,
      idleTimeoutMillis: config.database.idleTimeoutMillis,
    });
    expect(pool).toBeDefined();
  });

  it('should execute queries using the pool', async () => {
    const mockRes = { rows: [{ id: 1 }], rowCount: 1 };
    (getPool().query as jest.Mock).mockResolvedValueOnce(mockRes);

    const res = await query('SELECT * FROM users');
    expect(getPool().query).toHaveBeenCalledWith('SELECT * FROM users', undefined);
    expect(res).toEqual(mockRes);
  });
});
