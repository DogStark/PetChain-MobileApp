import { executeSql, queryAll } from '../localDB';
import { getCurrentAccountId } from '../authService';
import {
  exportLocalAuditCsv,
  getLocalAuditEvents,
  recordLocalAuditEvent,
} from '../localAuditService';

jest.mock('../localDB', () => ({
  executeSql: jest.fn().mockResolvedValue({ changes: 1 }),
  queryAll: jest.fn().mockResolvedValue([]),
}));
jest.mock('../authService', () => ({ getCurrentAccountId: jest.fn() }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: jest.fn().mockResolvedValue('sha256-reference-digest'),
}));

const mockedExecuteSql = executeSql as jest.MockedFunction<typeof executeSql>;
const mockedQueryAll = queryAll as jest.MockedFunction<typeof queryAll>;
const mockedAccountId = getCurrentAccountId as jest.MockedFunction<typeof getCurrentAccountId>;

describe('local audit service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExecuteSql.mockResolvedValue({ changes: 1, lastInsertRowId: 1 });
    mockedQueryAll.mockResolvedValue([]);
    mockedAccountId.mockResolvedValue('account-7');
  });

  it.each(['success', 'failure'] as const)('stores a %s event without its record reference', async (result) => {
    await recordLocalAuditEvent({
      action: 'REMOVE_LOCAL',
      recordReference: 'private-record-contents',
      result,
    });

    const insert = mockedExecuteSql.mock.calls.find(([sql]) => sql.includes('INSERT INTO local_audit_events'));
    expect(insert?.[1]).toEqual(
      expect.arrayContaining(['account-7', 'REMOVE_LOCAL', 'sha256-reference-digest', result]),
    );
    expect(JSON.stringify(insert?.[1])).not.toContain('private-record-contents');
  });

  it('reads only events belonging to the current account', async () => {
    await getLocalAuditEvents();

    expect(mockedQueryAll).toHaveBeenCalledWith(
      expect.stringContaining('WHERE account_id = ?'),
      ['account-7'],
    );
  });

  it('exports a redacted CSV without account ids or raw record references', async () => {
    mockedQueryAll.mockResolvedValue([
      {
        id: 'event-1',
        account_id: 'account-7',
        action: 'EXPORT',
        occurred_at: '2026-09-29T00:00:00.000Z',
        record_digest: 'digest-1',
        result: 'success',
      },
    ]);

    const csv = await exportLocalAuditCsv();

    expect(csv).toContain('timestamp,action,record_digest,result');
    expect(csv).toContain('digest-1');
    expect(csv).not.toContain('account-7');
    expect(csv).not.toContain('record contents');
  });

  it('applies the retention cutoff when recording events', async () => {
    await recordLocalAuditEvent({ action: 'EXPORT', recordReference: 'export', result: 'success' });

    expect(mockedExecuteSql).toHaveBeenCalledWith(
      'DELETE FROM local_audit_events WHERE occurred_at < ?',
      [expect.any(String)],
    );
  });
});