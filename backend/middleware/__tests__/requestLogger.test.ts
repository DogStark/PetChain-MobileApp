/**
 * Tests for requestLogger middleware
 * Issue #99 — Comprehensive Logging Infrastructure
 *
 * Verifies:
 * - X-Correlation-ID header is set on every response
 * - Incoming X-Correlation-ID is echoed back (not replaced)
 * - A new UUID is generated when no header is provided
 * - correlationId is accessible inside the request handler via AsyncLocalStorage
 */

import express, { type Request, type Response } from 'express';
import request from 'supertest';

import { getCorrelationId } from '../../utils/logger';
import { requestLogger, CORRELATION_HEADER } from '../requestLogger';

// ─── Test app ─────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(requestLogger);

  // Echo the correlation ID from the AsyncLocalStorage context
  app.get('/echo', (_req: Request, res: Response) => {
    res.json({ correlationId: getCorrelationId() });
  });

  // Simulate a 500 error for alert tracking tests
  app.get('/boom', (_req: Request, res: Response) => {
    res.status(500).json({ error: 'boom' });
  });

  return app;
}

const app = buildApp();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('requestLogger middleware', () => {
  it('sets X-Correlation-ID response header when none provided', async () => {
    const res = await request(app).get('/echo');
    expect(res.headers[CORRELATION_HEADER]).toBeDefined();
    expect(typeof res.headers[CORRELATION_HEADER]).toBe('string');
    expect(res.headers[CORRELATION_HEADER].length).toBeGreaterThan(0);
  });

  it('echoes back a provided X-Correlation-ID header', async () => {
    const clientId = 'my-client-correlation-id';
    const res = await request(app).get('/echo').set(CORRELATION_HEADER, clientId);

    expect(res.headers[CORRELATION_HEADER]).toBe(clientId);
  });

  it('generates a unique correlation ID per request when none provided', async () => {
    const [r1, r2] = await Promise.all([request(app).get('/echo'), request(app).get('/echo')]);
    const id1 = r1.headers[CORRELATION_HEADER];
    const id2 = r2.headers[CORRELATION_HEADER];
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  it('propagates correlationId into the handler via AsyncLocalStorage', async () => {
    const clientId = 'propagation-test-id';
    const res = await request(app).get('/echo').set(CORRELATION_HEADER, clientId);

    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBe(clientId);
  });

  it('generates a UUID-shaped correlation ID when none is provided', async () => {
    const res = await request(app).get('/echo');
    const id = res.headers[CORRELATION_HEADER] as string;
    // UUID v4 pattern
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('returns 500 on the /boom route and still sets correlation header', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.headers[CORRELATION_HEADER]).toBeDefined();
  });
});
