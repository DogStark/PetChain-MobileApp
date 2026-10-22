/**
 * Backend middleware that validates X-Request-Signature HMAC-SHA256 headers.
 *
 * The client signs: HMAC-SHA256(body + "|" + timestamp + "|" + nonce, signingKey)
 * where signingKey is derived from the user's session key stored in expo-secure-store.
 *
 * Rejects requests where:
 *  - the timestamp is > 5 minutes old (replay protection)
 *  - the signature is missing or does not match
 */

import { createHmac, timingSafeEqual } from 'crypto';

import type { NextFunction, Response } from 'express';

import type { AuthenticatedRequest } from './auth';
import { sendError } from '../server/response';

const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

function buildPayload(body: string, timestamp: string, nonce: string): string {
  return `${body}|${timestamp}|${nonce}`;
}

function hmacSha256(key: string, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('hex');
}

/**
 * Middleware factory.
 *
 * @param getSigningKey - async function that retrieves the signing key for the
 *   current request (e.g. from the user's session record). Returns null when
 *   no key is available (skip validation).
 */
export function validateRequestSignature(
  getSigningKey: (req: AuthenticatedRequest) => Promise<string | null>,
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const timestamp = req.headers['x-request-timestamp'] as string | undefined;
    const nonce = req.headers['x-request-nonce'] as string | undefined;
    const signature = req.headers['x-request-signature'] as string | undefined;

    // If none of the signing headers are present, skip validation (backwards compat)
    if (!timestamp && !nonce && !signature) {
      return next();
    }

    if (!timestamp || !nonce || !signature) {
      sendError(res, 400, 'MISSING_SIGNATURE_HEADERS', 'Request signing headers incomplete.');
      return;
    }

    // Replay protection: reject stale timestamps
    const ts = new Date(timestamp).getTime();
    if (isNaN(ts) || Date.now() - ts > MAX_AGE_MS) {
      sendError(res, 401, 'REQUEST_REPLAY', 'Request timestamp is too old or invalid.');
      return;
    }

    const key = await getSigningKey(req);
    if (!key) {
      // No signing key for this session — cannot validate; pass through
      return next();
    }

    const rawBody: string =
      typeof (req as any).rawBody === 'string'
        ? (req as any).rawBody
        : req.body != null
          ? typeof req.body === 'string'
            ? req.body
            : JSON.stringify(req.body)
          : '';

    const expected = hmacSha256(key, buildPayload(rawBody, timestamp, nonce));

    let match = false;
    try {
      match = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      match = false;
    }

    if (!match) {
      sendError(res, 401, 'INVALID_SIGNATURE', 'Request signature verification failed.');
      return;
    }

    next();
  };
}

/** Exported for tests */
export { hmacSha256, buildPayload };
