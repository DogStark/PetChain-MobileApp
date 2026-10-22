import { StellarAnchorService } from '../stellarService';

jest.mock('../../src/db', () => ({
  query: jest.fn(() => Promise.resolve({ rows: [] })),
}));

describe('StellarAnchorService', () => {
  it('hashes payloads deterministically with SHA-256', () => {
    const service = new StellarAnchorService();
    const a = service.hashPayload({ b: 2, a: 1 });
    const b = service.hashPayload({ a: 1, b: 2 });

    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('creates pending anchor records when no source secret is configured', async () => {
    const service = new StellarAnchorService();
    const result = await service.anchorRecord({ recordId: 'mr1', payload: { id: 'mr1' } });

    expect(result.status).toBe('pending');
    expect(result.recordHash).toHaveLength(64);
  });
});
