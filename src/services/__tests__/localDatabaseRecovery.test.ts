import type * as SQLite from 'expo-sqlite';

function installDatabaseMocks(initialIntegrity: 'ok' | 'corrupt') {
  const files = new Map<string, string>([
    ['file:///local/petchain.db', 'database'],
    ['file:///local/petchain.db-wal', 'wal'],
    ['file:///local/petchain.db-shm', 'shm'],
  ]);
  const storedValues = new Map<string, string>();
  let openCount = 0;

  const createDb = (integrity: 'ok' | 'corrupt') => ({
    databasePath: 'file:///local/petchain.db',
    getFirstAsync: jest.fn((sql: string) =>
      Promise.resolve(sql.includes('quick_check') ? { quick_check: integrity === 'ok' ? 'ok' : 'malformed' } : null),
    ),
    getAllAsync: jest.fn(async (sql: string) => {
      if (sql.includes('sqlite_master')) return [];
      return [];
    }),
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
    closeAsync: jest.fn().mockResolvedValue(undefined),
    withTransactionAsync: jest.fn(async (callback: () => Promise<void>) => callback()),
  });
  const corruptDb = createDb(initialIntegrity);
  const healthyDb = createDb('ok');

  jest.doMock('expo-sqlite', () => ({
    openDatabaseSync: jest.fn(() => {
      openCount += 1;
      return openCount === 1 ? corruptDb : healthyDb;
    }),
    deleteDatabaseAsync: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('expo-file-system', () => ({
    Paths: { document: 'file:///documents/' },
    File: class {
      uri: string;

      constructor(...parts: string[]) {
        this.uri = parts.length > 1 ? `${parts[0]}${parts.slice(1).join('/')}` : parts[0];
      }

      get exists() {
        return files.has(this.uri);
      }

      async move(destination: { uri: string }) {
        const content = files.get(this.uri);
        if (content === undefined) throw new Error('Source file missing');
        files.delete(this.uri);
        files.set(destination.uri, content);
        this.uri = destination.uri;
      }
    },
  }));
  jest.doMock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => storedValues.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => storedValues.set(key, value)),
    },
  }));
  jest.doMock('../../utils/encryption', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));

  return { files, storedValues, openDatabase: { corruptDb, healthyDb } };
}

describe('local database recovery', () => {
  beforeEach(() => jest.resetModules());

  it('starts healthy databases without quarantine', async () => {
    const mocks = installDatabaseMocks('ok');
    const localDB = await import('../localDB');

    await localDB.initializeLocalDatabase();

    expect(mocks.openDatabase.corruptDb.closeAsync).not.toHaveBeenCalled();
    expect(await localDB.getLocalDatabaseRecoveryInfo()).toBeNull();
  });

  it('preserves corrupt database files, returns a support code, and resumes migrations after restart', async () => {
    const mocks = installDatabaseMocks('corrupt');
    const localDB = await import('../localDB');

    const replacement = await localDB.initializeLocalDatabase();
    const recovery = await localDB.getLocalDatabaseRecoveryInfo();

    expect(mocks.openDatabase.corruptDb.closeAsync).toHaveBeenCalledTimes(1);
    expect(recovery?.supportCode).toMatch(/^DB-/);
    expect(recovery?.files).toHaveLength(3);
    expect([...mocks.files.keys()].filter((path) => path.includes('petchain-corrupt-'))).toHaveLength(3);

    const { runSqliteMigrations } = await import('../../migrations/sqliteMigrationRunner');
    await expect(runSqliteMigrations(replacement as SQLite.SQLiteDatabase, [])).resolves.toMatchObject({
      success: true,
      migrationsRun: 0,
    });

    jest.resetModules();
    const restartedLocalDB = await import('../localDB');
    await restartedLocalDB.initializeLocalDatabase();
    await expect(restartedLocalDB.getLocalDatabaseRecoveryInfo()).resolves.toEqual(recovery);
  });
});