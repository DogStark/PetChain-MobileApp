import {
  __resetReplayCache,
  isOriginAllowed,
  issueSignalingToken,
  verifySignalingToken,
} from '../webrtcAuth';

const BASE = {
  consultationId: 'consult-1',
  userId: 'user-1',
  role: 'owner',
  sessionId: 'sess-1',
};

describe('webrtcAuth signaling tokens', () => {
  beforeEach(() => __resetReplayCache());

  it('issues a token that verifies against a matching scope', () => {
    const { token } = issueSignalingToken(BASE);
    const result = verifySignalingToken(token, {
      consultationId: BASE.consultationId,
      userId: BASE.userId,
      sessionId: BASE.sessionId,
    });
    expect(result.ok).toBe(true);
  });

  it('characterizes the current gap: a guessed/hand-crafted token is rejected', () => {
    const forged = 'v1.eyJmb28iOiJiYXIifQ.not-a-real-signature';
    const result = verifySignalingToken(forged, {
      consultationId: BASE.consultationId,
      userId: BASE.userId,
      sessionId: BASE.sessionId,
    });
    expect(result).toMatchObject({ ok: false, code: 'BAD_SIGNATURE' });
  });

  it('rejects a token replayed a second time (single-use nonce)', () => {
    const { token } = issueSignalingToken(BASE);
    const first = verifySignalingToken(token, BASE);
    const second = verifySignalingToken(token, BASE);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, code: 'REPLAYED' });
  });

  it('rejects a token reused for a different consultation or user', () => {
    const { token } = issueSignalingToken(BASE);
    const result = verifySignalingToken(token, { ...BASE, consultationId: 'other-consult' });
    expect(result).toMatchObject({ ok: false, code: 'SCOPE_MISMATCH' });
  });

  it('rejects an expired token', () => {
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    const { token } = issueSignalingToken({ ...BASE, ttlSeconds: 60, now: t0 });
    const result = verifySignalingToken(token, { ...BASE, now: t0 + 61_000 });
    expect(result).toMatchObject({ ok: false, code: 'EXPIRED' });
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const { token } = issueSignalingToken(BASE);
    const [h, , s] = token.split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...BASE, role: 'vet' })).toString(
      'base64url',
    )}.${s}`;
    const result = verifySignalingToken(tampered, BASE);
    expect(result).toMatchObject({ ok: false, code: 'BAD_SIGNATURE' });
  });

  it('handles malformed input without throwing', () => {
    expect(verifySignalingToken('', BASE)).toMatchObject({ ok: false, code: 'MALFORMED' });
    // @ts-expect-error deliberate bad input
    expect(verifySignalingToken(null, BASE)).toMatchObject({ ok: false, code: 'MALFORMED' });
    expect(verifySignalingToken('a.b', BASE)).toMatchObject({ ok: false, code: 'MALFORMED' });
  });

  it('allows any origin when no allow-list is configured', () => {
    expect(isOriginAllowed('https://anything.example')).toBe(true);
    expect(isOriginAllowed(undefined)).toBe(true);
  });

  it('does not embed PHI — only opaque ids, timestamps and a nonce', () => {
    const { token } = issueSignalingToken(BASE);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(Object.keys(payload).sort()).toEqual(
      ['consultationId', 'exp', 'iat', 'nonce', 'role', 'sessionId', 'userId'].sort(),
    );
  });
});
