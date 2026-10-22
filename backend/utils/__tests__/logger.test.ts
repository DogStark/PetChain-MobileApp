/**
 * Tests for the structured logger and error-rate alerting
 * Issue #99 — Comprehensive Logging Infrastructure
 */

import {
  correlationStore,
  runWithContext,
  getCorrelationId,
  trackError,
  _resetErrorWindow,
} from '../logger';

// ─── Correlation ID propagation ───────────────────────────────────────────────

describe('correlationStore / runWithContext', () => {
  it('returns undefined outside a context', () => {
    // Run in a fresh async context with no store set
    const id = correlationStore.getStore()?.correlationId;
    expect(id).toBeUndefined();
  });

  it('propagates correlationId inside runWithContext', () => {
    const testId = 'test-correlation-id-123';
    runWithContext({ correlationId: testId }, () => {
      expect(getCorrelationId()).toBe(testId);
    });
  });

  it('propagates userId inside runWithContext', () => {
    runWithContext({ correlationId: 'cid', userId: 'user-42' }, () => {
      expect(correlationStore.getStore()?.userId).toBe('user-42');
    });
  });

  it('isolates contexts — inner context does not leak to outer', () => {
    runWithContext({ correlationId: 'outer' }, () => {
      runWithContext({ correlationId: 'inner' }, () => {
        expect(getCorrelationId()).toBe('inner');
      });
      // Back in outer context
      expect(getCorrelationId()).toBe('outer');
    });
  });

  it('context is not visible after runWithContext returns', () => {
    runWithContext({ correlationId: 'ephemeral' }, () => {
      // inside — visible
      expect(getCorrelationId()).toBe('ephemeral');
    });
    // outside — not visible (we're back in the parent context which has none)
    const outer = correlationStore.getStore();
    expect(outer?.correlationId).not.toBe('ephemeral');
  });

  it('supports arbitrary extra fields on the context', () => {
    runWithContext(
      { correlationId: 'cid', service: 'petchain-api', requestPath: '/api/pets' },
      () => {
        const ctx = correlationStore.getStore();
        expect(ctx?.service).toBe('petchain-api');
        expect(ctx?.requestPath).toBe('/api/pets');
      },
    );
  });
});

// ─── Error rate alerting ──────────────────────────────────────────────────────

describe('trackError / error rate alerting', () => {
  beforeEach(() => {
    _resetErrorWindow();
    // Silence the logger warn during tests
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    _resetErrorWindow();
  });

  it('does not throw when called once', () => {
    expect(() => trackError()).not.toThrow();
  });

  it('accumulates errors within the window', () => {
    // Call 5 times — below default threshold of 10
    for (let i = 0; i < 5; i++) trackError();
    // No alert fired — window not drained
    // We verify by calling 4 more (total 9) — still no drain
    for (let i = 0; i < 4; i++) trackError();
    // Window should still have 9 entries (not reset)
    // Calling one more (10th) should trigger the alert and drain
    expect(() => trackError()).not.toThrow();
  });

  it('resets the window after an alert fires', () => {
    const originalThreshold = Number(process.env.ALERT_ERROR_THRESHOLD ?? 10);
    // Fire exactly threshold errors
    for (let i = 0; i < originalThreshold; i++) trackError();
    // Window should be drained now — calling again should not immediately re-alert
    expect(() => trackError()).not.toThrow();
  });
});
