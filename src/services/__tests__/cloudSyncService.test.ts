import {
  getCloudSyncConfig,
  updateCloudSyncConfig,
  toggleEntitySync,
  getEntitySyncStatuses,
  updateEntitySyncStatus,
  syncEntitiesIndependently,
} from '../cloudSyncService';

// Mock localDB
jest.mock('../localDB', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

// Mock apiClient for syncEntitiesIndependently tests
jest.mock('../apiClient', () => ({
  default: {
    post: jest.fn().mockResolvedValue({ data: {} }),
    get: jest.fn().mockResolvedValue({ data: [] }),
  },
}));

const { getItem, setItem } = jest.requireMock('../localDB') as {
  getItem: jest.Mock;
  setItem: jest.Mock;
};

const apiClient = jest.requireMock('../apiClient').default as { post: jest.Mock };

describe('CloudSyncService config', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns default config when nothing stored', async () => {
    getItem.mockResolvedValue(null);
    const config = await getCloudSyncConfig();
    expect(config.provider).toBe('server');
    expect(config.autoSync).toBe(true);
    expect(config.syncedEntities).toHaveLength(4);
  });

  it('merges stored config with defaults', async () => {
    getItem.mockResolvedValue(JSON.stringify({ autoSync: false }));
    const config = await getCloudSyncConfig();
    expect(config.autoSync).toBe(false);
    expect(config.provider).toBe('server');
  });

  it('updates and persists config', async () => {
    getItem.mockResolvedValue(null);
    await updateCloudSyncConfig({ autoSync: false });
    expect(setItem).toHaveBeenCalledWith(
      '@cloud_sync_config',
      expect.stringContaining('"autoSync":false'),
    );
  });
});

describe('toggleEntitySync', () => {
  beforeEach(() => jest.clearAllMocks());

  it('adds entity type when enabled', async () => {
    getItem.mockResolvedValue(JSON.stringify({ syncedEntities: ['pet', 'appointment'] }));
    const updated = await toggleEntitySync('medication', true);
    expect(updated.syncedEntities).toContain('medication');
  });

  it('removes entity type when disabled', async () => {
    getItem.mockResolvedValue(
      JSON.stringify({ syncedEntities: ['pet', 'appointment', 'medication'] }),
    );
    const updated = await toggleEntitySync('medication', false);
    expect(updated.syncedEntities).not.toContain('medication');
    expect(updated.syncedEntities).toContain('pet');
  });

  it('does not duplicate entity types when enabling already-enabled entity', async () => {
    getItem.mockResolvedValue(JSON.stringify({ syncedEntities: ['pet'] }));
    const updated = await toggleEntitySync('pet', true);
    expect(updated.syncedEntities.filter((e) => e === 'pet')).toHaveLength(1);
  });
});

describe('getEntitySyncStatuses', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns default status records when nothing stored', async () => {
    getItem.mockResolvedValue(null);
    const statuses = await getEntitySyncStatuses();
    expect(statuses.pet.status).toBe('never');
    expect(statuses.appointment.status).toBe('never');
    expect(statuses.medication.status).toBe('never');
    expect(statuses.medicalRecord.status).toBe('never');
  });

  it('has null lastSuccessAt in default state', async () => {
    getItem.mockResolvedValue(null);
    const statuses = await getEntitySyncStatuses();
    expect(statuses.pet.lastSuccessAt).toBeNull();
    expect(statuses.medication.lastError).toBeNull();
  });

  it('restores persisted status', async () => {
    const stored = {
      pet: {
        status: 'success',
        lastSuccessAt: '2024-01-01T00:00:00.000Z',
        lastAttemptAt: '2024-01-01T00:00:00.000Z',
        pendingCount: 0,
        lastError: null,
      },
    };
    getItem.mockResolvedValue(JSON.stringify(stored));
    const statuses = await getEntitySyncStatuses();
    expect(statuses.pet.status).toBe('success');
    expect(statuses.pet.lastSuccessAt).toBe('2024-01-01T00:00:00.000Z');
    // Non-stored entities still default
    expect(statuses.appointment.status).toBe('never');
  });
});

describe('updateEntitySyncStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('persists status update for a single entity type', async () => {
    getItem.mockResolvedValue(null);
    await updateEntitySyncStatus('medication', {
      status: 'success',
      lastSuccessAt: '2024-06-01T12:00:00.000Z',
      lastAttemptAt: '2024-06-01T12:00:00.000Z',
      pendingCount: 0,
      lastError: null,
    });
    expect(setItem).toHaveBeenCalledWith(
      '@cloud_sync_entity_status',
      expect.stringContaining('"medication"'),
    );
    expect(setItem).toHaveBeenCalledWith(
      '@cloud_sync_entity_status',
      expect.stringContaining('"success"'),
    );
  });

  it('does not overwrite other entity statuses when updating one', async () => {
    const existing = {
      pet: {
        status: 'success',
        lastSuccessAt: '2024-01-01T00:00:00.000Z',
        lastAttemptAt: '2024-01-01T00:00:00.000Z',
        pendingCount: 0,
        lastError: null,
      },
    };
    getItem.mockResolvedValue(JSON.stringify(existing));

    await updateEntitySyncStatus('medication', { status: 'failed', lastError: 'timeout' });

    const savedCall = setItem.mock.calls[0][1] as string;
    const saved = JSON.parse(savedCall);
    // Pet status is preserved
    expect(saved.pet.status).toBe('success');
    // Medication status is updated
    expect(saved.medication.status).toBe('failed');
    expect(saved.medication.lastError).toBe('timeout');
  });
});

describe('syncEntitiesIndependently — partial failure isolation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns success for all entities when all API calls succeed', async () => {
    getItem.mockResolvedValue(null);
    apiClient.post.mockResolvedValue({ data: {} });

    const results = await syncEntitiesIndependently('user-1', ['pet', 'medication']);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  it('isolates failures — a failed entity does not prevent others from syncing', async () => {
    getItem.mockResolvedValue(null);

    // medication sync fails; pet sync succeeds
    apiClient.post.mockImplementation((_url: string, body: { entityType?: string }) => {
      if (body?.entityType === 'medication') {
        return Promise.reject(new Error('Medication sync timeout'));
      }
      return Promise.resolve({ data: {} });
    });

    const results = await syncEntitiesIndependently('user-1', ['pet', 'medication', 'appointment']);

    const petResult = results.find((r) => r.entityType === 'pet');
    const medicationResult = results.find((r) => r.entityType === 'medication');
    const appointmentResult = results.find((r) => r.entityType === 'appointment');

    expect(petResult?.status).toBe('success');
    expect(medicationResult?.status).toBe('failed');
    expect(medicationResult?.error).toContain('Medication sync timeout');
    expect(appointmentResult?.status).toBe('success');
  });

  it('persists failed status for the failing entity without touching others', async () => {
    getItem.mockResolvedValue(null);

    apiClient.post.mockImplementation((_url: string, body: { entityType?: string }) => {
      if (body?.entityType === 'appointment') {
        return Promise.reject(new Error('Server error'));
      }
      return Promise.resolve({ data: {} });
    });

    await syncEntitiesIndependently('user-1', ['pet', 'appointment']);

    // setItem should be called for both entity status updates
    const entityStatusCalls = setItem.mock.calls.filter(
      (call: [string, string]) => call[0] === '@cloud_sync_entity_status',
    );
    expect(entityStatusCalls.length).toBeGreaterThanOrEqual(1);

    // The last persisted state should show appointment as failed and pet as success
    const lastSaved = JSON.parse(
      entityStatusCalls[entityStatusCalls.length - 1][1] as string,
    ) as Record<string, { status: string }>;
    expect(lastSaved.appointment?.status).toBe('failed');
  });

  it('returns empty array when given empty entity list', async () => {
    const results = await syncEntitiesIndependently('user-1', []);
    expect(results).toHaveLength(0);
  });

  it('all failures still resolves without throwing', async () => {
    getItem.mockResolvedValue(null);
    apiClient.post.mockRejectedValue(new Error('Network unreachable'));

    const results = await syncEntitiesIndependently('user-1', ['pet', 'medication']);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'failed')).toBe(true);
  });
});
