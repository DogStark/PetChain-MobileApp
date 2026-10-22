import axios from 'axios';

import {
  getMedicalRecords,
  searchMedicalRecords,
  searchRecords,
  type MedicalRecord,
} from '../medicalRecordService';

jest.mock('axios');
jest.mock('../localDB', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('../blockchainService', () => ({
  storeMedicalRecordOnChain: jest.fn(),
  verifyMedicalRecordOnChain: jest.fn(),
}));
jest.mock('../offlineQueue', () => ({ default: { enqueue: jest.fn() } }));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const PET_ID = 'pet-abc';

const makeRecord = (overrides: Partial<MedicalRecord> = {}): MedicalRecord => ({
  id: 'rec-1',
  petId: PET_ID,
  type: 'vaccination',
  date: '2024-03-01',
  veterinarian: 'Dr. Smith',
  notes: 'Annual rabies shot',
  createdAt: '2024-03-01T10:00:00Z',
  ...overrides,
});

const paginatedResponse = (records: MedicalRecord[]) => ({
  data: { data: records, total: records.length, page: 1, limit: 10, totalPages: 1 },
});

beforeEach(() => jest.clearAllMocks());

describe('getMedicalRecords', () => {
  it('returns records without filters', async () => {
    mockedAxios.get.mockResolvedValue(paginatedResponse([makeRecord()]));

    const result = await getMedicalRecords(PET_ID);

    expect(result.data).toHaveLength(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining(`/pets/${PET_ID}/medical-records`),
    );
  });

  it('passes type filter in query string', async () => {
    mockedAxios.get.mockResolvedValue(paginatedResponse([makeRecord()]));

    await getMedicalRecords(PET_ID, { type: 'vaccination' });

    expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('type=vaccination'));
  });

  it('passes startDate filter in query string', async () => {
    mockedAxios.get.mockResolvedValue(paginatedResponse([]));

    await getMedicalRecords(PET_ID, { startDate: '2024-01-01' });

    expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('startDate=2024-01-01'));
  });

  it('passes endDate filter in query string', async () => {
    mockedAxios.get.mockResolvedValue(paginatedResponse([]));

    await getMedicalRecords(PET_ID, { endDate: '2024-12-31' });

    expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('endDate=2024-12-31'));
  });

  it('passes combined type + date range filters', async () => {
    mockedAxios.get.mockResolvedValue(paginatedResponse([makeRecord()]));

    await getMedicalRecords(PET_ID, {
      type: 'treatment',
      startDate: '2024-01-01',
      endDate: '2024-06-30',
    });

    const url: string = mockedAxios.get.mock.calls[0][0];
    expect(url).toContain('type=treatment');
    expect(url).toContain('startDate=2024-01-01');
    expect(url).toContain('endDate=2024-06-30');
  });

  it('passes pagination params', async () => {
    mockedAxios.get.mockResolvedValue(paginatedResponse([]));

    await getMedicalRecords(PET_ID, { page: 2, limit: 5 });

    const url: string = mockedAxios.get.mock.calls[0][0];
    expect(url).toContain('page=2');
    expect(url).toContain('limit=5');
  });

  it('throws MedicalRecordError when petId is empty', async () => {
    await expect(getMedicalRecords('')).rejects.toThrow('Pet ID is required');
  });

  it('throws NOT_FOUND error on 404', async () => {
    mockedAxios.get.mockRejectedValue({
      response: { status: 404, data: {} },
    });
    mockedAxios.isAxiosError.mockReturnValue(true);

    await expect(getMedicalRecords(PET_ID)).rejects.toThrow('Pet or records not found');
  });

  it('throws UNAUTHORIZED error on 401', async () => {
    mockedAxios.get.mockRejectedValue({
      response: { status: 401, data: {} },
    });
    mockedAxios.isAxiosError.mockReturnValue(true);

    await expect(getMedicalRecords(PET_ID)).rejects.toThrow('Unauthorized access');
  });
});

describe('searchMedicalRecords', () => {
  it('returns records matching the query', async () => {
    const records = [
      makeRecord({ notes: 'rabies vaccination' }),
      makeRecord({ id: 'rec-2', notes: 'dental cleaning' }),
    ];
    mockedAxios.get.mockResolvedValue(paginatedResponse(records));

    const results = await searchMedicalRecords(PET_ID, 'rabies');

    expect(results).toHaveLength(1);
    expect(results[0].notes).toContain('rabies');
  });

  it('returns empty array for blank query', async () => {
    const results = await searchMedicalRecords(PET_ID, '   ');
    expect(results).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('throws when petId is empty', async () => {
    await expect(searchMedicalRecords('', 'rabies')).rejects.toThrow('Pet ID is required');
  });
});

describe('searchRecords (FTS — Issue #536)', () => {
  it('returns ranked results from the backend FTS endpoint', async () => {
    const records = [makeRecord({ notes: 'rabies vaccination annual' })];
    mockedAxios.get.mockResolvedValueOnce({ data: records });

    const results = await searchRecords(PET_ID, 'rabies');
    expect(results).toEqual(records);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/medical-records/search'),
      expect.objectContaining({ params: { q: 'rabies' } }),
    );
  });

  it('falls back to ILIKE search when FTS endpoint returns 404 (SQLite)', async () => {
    // FTS endpoint not available → fall back
    mockedAxios.get.mockRejectedValueOnce({
      response: { status: 404 },
      isAxiosError: true,
    });
    // Fallback getMedicalRecords call
    const records = [makeRecord({ notes: 'dental cleaning' })];
    mockedAxios.get.mockResolvedValueOnce(paginatedResponse(records));
    mockedAxios.isAxiosError.mockReturnValue(true);

    const results = await searchRecords(PET_ID, 'dental');
    expect(results).toHaveLength(1);
  });

  it('returns empty array for blank query without hitting network', async () => {
    const results = await searchRecords(PET_ID, '   ');
    expect(results).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('throws when petId is empty', async () => {
    await expect(searchRecords('', 'rabies')).rejects.toThrow('Pet ID is required');
  });
});
