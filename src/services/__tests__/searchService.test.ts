import { globalSearch } from '../searchService';

// Mock apiClient to simulate offline
jest.mock('../apiClient', () => ({
  default: {
    get: jest.fn().mockRejectedValue(new Error('Network error')),
  },
}));

jest.mock('../../utils/errorLogger', () => ({
  logError: jest.fn(),
}));

const LOCAL_DATA = {
  pets: [
    { id: 'p1', name: 'Buddy', species: 'Dog', breed: 'Labrador' },
    { id: 'p2', name: 'Whiskers', species: 'Cat' },
  ],
  appointments: [
    {
      id: 'a1',
      title: 'Annual Checkup',
      petName: 'Buddy',
      date: '2025-06-01',
      status: 'scheduled',
    },
  ],
  medicalRecords: [{ id: 'm1', title: 'Vaccination Record', petName: 'Whiskers', type: 'vaccine' }],
};

describe('globalSearch (offline fallback)', () => {
  it('returns empty results for empty query', async () => {
    const result = await globalSearch('', 'all', LOCAL_DATA);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('finds pets by name', async () => {
    const result = await globalSearch('Buddy', 'pets', LOCAL_DATA);
    expect(result.items.some((i) => i.id === 'p1' && i.category === 'pets')).toBe(true);
    expect(result.fromCache).toBe(true);
  });

  it('finds pets by species', async () => {
    const result = await globalSearch('cat', 'pets', LOCAL_DATA);
    expect(result.items.some((i) => i.id === 'p2')).toBe(true);
  });

  it('finds appointments by title', async () => {
    const result = await globalSearch('checkup', 'appointments', LOCAL_DATA);
    expect(result.items.some((i) => i.category === 'appointments')).toBe(true);
  });

  it('finds medical records by type', async () => {
    const result = await globalSearch('vaccine', 'medical_records', LOCAL_DATA);
    expect(result.items.some((i) => i.category === 'medical_records')).toBe(true);
  });

  it('searches all categories by default', async () => {
    const result = await globalSearch('Buddy', 'all', LOCAL_DATA);
    const categories = result.items.map((i) => i.category);
    expect(categories).toContain('pets');
    expect(categories).toContain('appointments');
  });

  it('returns fromCache=true when offline', async () => {
    const result = await globalSearch('Buddy', 'all', LOCAL_DATA);
    expect(result.fromCache).toBe(true);
  });

  it('returns accurate total count', async () => {
    const result = await globalSearch('Buddy', 'all', LOCAL_DATA);
    expect(result.total).toBe(result.items.length);
  });
});
