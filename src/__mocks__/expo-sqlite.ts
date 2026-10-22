type MigrationRow = {
  version: string;
  description: string;
  checksum: string;
  applied_at: string;
  status: 'applied' | 'rolled_back';
};

const tableStore = new Map<string, MigrationRow[]>();
const kvStore = new Map<string, string>();

function ensureSchemaMigrationsTable(): void {
  if (!tableStore.has('schema_migrations')) {
    tableStore.set('schema_migrations', []);
  }
}

function normalizeSql(sql = ''): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function executeSql(sql: string, params: any[] = []): Promise<any[]> {
  const normalized = normalizeSql(sql);

  if (normalized.startsWith('create table if not exists schema_migrations')) {
    ensureSchemaMigrationsTable();
    return [];
  }

  // Ignore ALTER TABLE (checksum column addition) — no-op in mock
  if (normalized.startsWith('alter table schema_migrations')) {
    return [];
  }

  if (normalized.startsWith('insert or replace into schema_migrations')) {
    ensureSchemaMigrationsTable();
    const rows = tableStore.get('schema_migrations')!;
    // Params: [version, description, checksum] — applied_at and status are SQL literals
    const [version, description, checksum = ''] = params;
    const applied_at = new Date().toISOString();
    const existing = rows.find((row) => row.version === version);
    const record: MigrationRow = { version, description, checksum, applied_at, status: 'applied' };
    if (existing) {
      Object.assign(existing, record);
    } else {
      rows.push(record);
    }
    return [];
  }

  if (
    normalized.startsWith("update schema_migrations set status = 'rolled_back' where version = ?")
  ) {
    ensureSchemaMigrationsTable();
    const rows = tableStore.get('schema_migrations')!;
    const [version] = params;
    const existing = rows.find((row) => row.version === version);
    if (existing) {
      existing.status = 'rolled_back';
    }
    return [];
  }

  // checksum-aware select (new)
  if (normalized.includes('select version, checksum from schema_migrations')) {
    ensureSchemaMigrationsTable();
    return tableStore
      .get('schema_migrations')!
      .filter((row) => row.status === 'applied')
      .map((row) => ({ version: row.version, checksum: row.checksum ?? '' }));
  }

  // legacy select (kept for backward compat)
  if (
    normalized.startsWith(
      "select version from schema_migrations where status = 'applied' order by version asc",
    )
  ) {
    ensureSchemaMigrationsTable();
    return tableStore
      .get('schema_migrations')!
      .filter((row) => row.status === 'applied')
      .map((row) => ({ version: row.version }));
  }

  if (
    normalized.startsWith(
      'select version, description, applied_at, status from schema_migrations order by version asc',
    )
  ) {
    ensureSchemaMigrationsTable();
    return [...tableStore.get('schema_migrations')!];
  }

  if (normalized.startsWith('drop table if exists schema_migrations')) {
    tableStore.delete('schema_migrations');
    return [];
  }

  // Generic key/value store (`kv_store`). Supports the AsyncStorage-like subset
  // of SQL emitted by localDB.get/set/remove/multiGet/multiSet. Values are stored
  // as-is (they are already encrypted by localDB before insert) so reads can
  // round-trip through the encryption wrapper in tests.
  if (normalized.startsWith('insert or replace into kv_store (key, value) values (?, ?)')) {
    const [key, value] = params;
    kvStore.set(String(key), String(value));
    return [];
  }

  if (normalized.startsWith('insert or replace into kv_store')) {
    // Fallback for alternate column ordering: last param is the value.
    const [key, value] = params;
    kvStore.set(String(key), String(value));
    return [];
  }

  if (normalized.startsWith('select value from kv_store where key = ? limit 1')) {
    const [key] = params;
    const value = kvStore.get(String(key));
    return value === undefined ? [] : [{ value }];
  }

  if (normalized.startsWith('select key, value from kv_store where key in (')) {
    return params
      .map((key) => ({ key: String(key), value: kvStore.get(String(key)) }))
      .filter((row) => row.value !== undefined);
  }

  if (normalized.startsWith('delete from kv_store where key = ?')) {
    const [key] = params;
    kvStore.delete(String(key));
    return [];
  }

  return [];
}

const mockResultSet = { rows: { length: 0, item: () => null } };

const mockTx = {
  executeSql: jest.fn((sql, params, success, _error) => {
    if (success) success(mockTx, mockResultSet);
    return mockTx;
  }),
};

const mockDb = {
  execAsync: jest.fn((sql: string) => executeSql(sql)),
  runAsync: jest.fn((sql: string, params: any[] = []) =>
    executeSql(sql, params).then(() => ({ changes: 1, lastInsertRowId: 1 })),
  ),
  getFirstAsync: jest.fn((sql: string, params: any[] = []) =>
    executeSql(sql, params).then((rows) => (rows.length ? rows[0] : null)),
  ),
  getAllAsync: jest.fn((sql: string, params: any[] = []) => executeSql(sql, params)),
  withTransactionAsync: jest.fn(async (callback: () => Promise<void>) => callback()),
  transaction: jest.fn((callback: (tx: typeof mockTx) => void) => {
    callback(mockTx);
  }),
};

export const openDatabase = jest.fn(() => mockDb);
export const openDatabaseSync = jest.fn(() => mockDb);

/** Test helper: reset the in-memory tables so tests don't leak state. */
export const __resetMockStorage = (): void => {
  tableStore.clear();
  kvStore.clear();
};
