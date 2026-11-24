import { jest } from '@jest/globals';

const mockElastic = {
  search: jest.fn(),
  index: jest.fn(),
  delete: jest.fn(),
  indices: {
    exists: jest.fn(),
    create: jest.fn(),
  },
};

jest.mock(
  '@elastic/elasticsearch',
  () => ({
    Client: jest.fn().mockImplementation(() => mockElastic),
  }),
  { virtual: true },
);

jest.mock('../../src/db', () => ({
  query: jest.fn(),
}));

describe('searchService', () => {
  const originalUrl = process.env.ELASTICSEARCH_URL;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.ELASTICSEARCH_URL;
    else process.env.ELASTICSEARCH_URL = originalUrl;
  });

  it('returns Elasticsearch hits when configured', async () => {
    process.env.ELASTICSEARCH_URL = 'http://localhost:9200';
    mockElastic.search.mockResolvedValue({
      hits: {
        total: { value: 1 },
        hits: [
          {
            _id: 'pet-1',
            _index: 'pets',
            _score: 2.5,
            _source: { name: 'Buddy' },
            highlight: { name: ['<mark>Buddy</mark>'] },
          },
        ],
      },
    });

    const service = await import('../searchService');
    const result = await service.search('Buddy', { indices: [service.INDICES.pets] });

    expect(result.total).toBe(1);
    expect(result.hits[0]).toMatchObject({ id: 'pet-1', index: 'pets', score: 2.5 });
  });

  it('falls back to PostgreSQL FTS when Elasticsearch fails', async () => {
    process.env.ELASTICSEARCH_URL = 'http://localhost:9200';
    mockElastic.search.mockRejectedValue(new Error('unavailable'));

    const db = jest.requireMock('../../src/db') as { query: jest.Mock };
    (db.query as jest.Mock).mockResolvedValue({
      rows: [{ id: 'pet-1', name: 'Buddy' }],
      rowCount: 1,
    });

    const service = await import('../searchService');
    const result = await service.search('Buddy', { indices: [service.INDICES.pets] });

    expect(result.total).toBe(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('plainto_tsquery'),
      expect.any(Array),
    );
  });

  it('defines mappings and seeds pets and medical records', async () => {
    process.env.ELASTICSEARCH_URL = 'http://localhost:9200';
    mockElastic.indices.exists.mockResolvedValue(false);

    const db = jest.requireMock('../../src/db') as { query: jest.Mock };
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 'pet-1', name: 'Buddy' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'record-1', diagnosis: 'Healthy' }], rowCount: 1 });

    const service = await import('../searchService');
    await service.ensureIndices();

    expect(mockElastic.indices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'pets',
        mappings: expect.objectContaining({ properties: expect.any(Object) }),
      }),
    );
    expect(mockElastic.indices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'medical_records',
        mappings: expect.objectContaining({ properties: expect.any(Object) }),
      }),
    );
  });

  it('uses PostgreSQL directly when ELASTICSEARCH_URL is not set', async () => {
    delete process.env.ELASTICSEARCH_URL;

    const db = jest.requireMock('../../src/db') as { query: jest.Mock };
    (db.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0 });

    const service = await import('../searchService');
    const result = await service.search('nothing', { indices: [service.INDICES.pets] });

    expect(result).toEqual({ hits: [], total: 0 });
  });
});
