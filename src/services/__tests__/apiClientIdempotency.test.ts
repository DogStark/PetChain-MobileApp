/**
 * #976 — API idempotency keys for all mobile mutations.
 *
 * Characterizes the gap (a bare mutation config carries no key), then verifies
 * the helper that the request interceptor uses: mutations get a stable key,
 * reads do not, explicit keys are preserved, and a pinned key survives retries.
 */
import {
  IDEMPOTENCY_HEADER,
  generateIdempotencyKey,
  readIdempotencyKey,
  withIdempotencyKey,
} from '../apiClient';

describe('#976 idempotency keys', () => {
  it('reproduces the gap: a raw mutation config has no idempotency key', () => {
    const cfg = { method: 'post', url: '/appointments', data: { petId: 'pet-1' } };
    expect(readIdempotencyKey(cfg as never)).toBeUndefined();
  });

  it('generateIdempotencyKey returns unique RFC-4122 v4 identifiers', () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(a).not.toBe(b);
  });

  it.each(['post', 'put', 'patch', 'delete'])('stamps a key on %s mutations', (method) => {
    const cfg = withIdempotencyKey({ method, url: '/x', data: {} });
    expect(readIdempotencyKey(cfg.headers as never)).toBeDefined();
  });

  it.each(['get', 'head', 'options'])('leaves %s reads untouched', (method) => {
    const cfg = withIdempotencyKey({ method, url: '/x' });
    expect(readIdempotencyKey(cfg.headers as never)).toBeUndefined();
  });

  it('preserves an explicit caller-supplied key (offline replay path)', () => {
    const existing = 'fixed-key-from-offline-queue';
    const cfg = withIdempotencyKey({
      method: 'put',
      url: '/pets/pet-1',
      headers: { [IDEMPOTENCY_HEADER]: existing },
    });
    expect(readIdempotencyKey(cfg.headers as never)).toBe(existing);
  });

  it('is idempotent itself: re-stamping the same config keeps the first key (retry safety)', () => {
    const cfg = withIdempotencyKey({ method: 'post', url: '/payments', data: { amount: 10 } });
    const first = readIdempotencyKey(cfg.headers as never);
    withIdempotencyKey(cfg);
    withIdempotencyKey(cfg);
    expect(readIdempotencyKey(cfg.headers as never)).toBe(first);
  });

  it('matches a case-insensitive header name', () => {
    expect(readIdempotencyKey({ 'idempotency-key': 'abc' })).toBe('abc');
  });
});
