import express from 'express';
import request from 'supertest';

import { buildPayload, hmacSha256, validateRequestSignature } from '../requestSigning';

const TEST_KEY = 'test-signing-key-abc123';

function makeApp(key: string | null = TEST_KEY) {
  const app = express();
  app.use(express.json());
  app.use(validateRequestSignature(async () => key));
  app.post('/data', (req, res) => res.json({ ok: true }));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

function sign(body: string, timestamp: string, nonce: string, key = TEST_KEY) {
  return hmacSha256(key, buildPayload(body, timestamp, nonce));
}

function freshTimestamp() {
  return new Date().toISOString();
}

describe('validateRequestSignature middleware', () => {
  it('passes with valid signature on POST', async () => {
    const app = makeApp();
    const body = JSON.stringify({ hello: 'world' });
    const ts = freshTimestamp();
    const nonce = 'abc123nonce';
    const sig = sign(body, ts, nonce);

    const res = await request(app)
      .post('/data')
      .set('Content-Type', 'application/json')
      .set('X-Request-Timestamp', ts)
      .set('X-Request-Nonce', nonce)
      .set('X-Request-Signature', sig)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects replayed request with old timestamp', async () => {
    const app = makeApp();
    const oldTs = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const nonce = 'nonce1';
    const body = '';
    const sig = sign(body, oldTs, nonce);

    const res = await request(app)
      .get('/ping')
      .set('X-Request-Timestamp', oldTs)
      .set('X-Request-Nonce', nonce)
      .set('X-Request-Signature', sig);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REQUEST_REPLAY');
  });

  it('rejects tampered body', async () => {
    const app = makeApp();
    const ts = freshTimestamp();
    const nonce = 'nonce2';
    // Sign original body but send different body
    const sig = sign(JSON.stringify({ original: true }), ts, nonce);

    const res = await request(app)
      .post('/data')
      .set('Content-Type', 'application/json')
      .set('X-Request-Timestamp', ts)
      .set('X-Request-Nonce', nonce)
      .set('X-Request-Signature', sig)
      .send(JSON.stringify({ tampered: true }));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('allows requests without any signing headers (backwards compat)', async () => {
    const app = makeApp();
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
  });

  it('returns 400 when signing headers are partially present', async () => {
    const app = makeApp();
    const res = await request(app).get('/ping').set('X-Request-Timestamp', freshTimestamp());
    // Only timestamp, missing nonce + signature
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_SIGNATURE_HEADERS');
  });

  it('skips validation when no signing key is available', async () => {
    const app = makeApp(null);
    const ts = freshTimestamp();
    // Provide headers so the middleware tries to validate, but key is null
    const res = await request(app)
      .get('/ping')
      .set('X-Request-Timestamp', ts)
      .set('X-Request-Nonce', 'n')
      .set('X-Request-Signature', 'deadbeef');
    // key is null → pass through without validation
    expect(res.status).toBe(200);
  });
});
