/**
 * Authenticate third-party requests via X-Api-Key header with scoped permissions,
 * per-endpoint usage tracking, and rate limiting.
 */

import { type NextFunction, type Response } from 'express';

import type { AuthenticatedRequest } from './auth';
import type { ApiKey, ApiKeyScope } from '../models/ApiKey';
import { sendError } from '../server/response';
import apiKeyService from '../services/apiKeyService';

export interface ApiKeyAuthenticatedRequest extends AuthenticatedRequest {
  apiKey?: ApiKey;
}

function extractApiKey(req: AuthenticatedRequest): string | null {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }

  const auth = req.headers.authorization;
  if (auth?.startsWith('ApiKey ')) {
    return auth.slice('ApiKey '.length).trim();
  }

  return null;
}

/**
 * Require a valid API key. Optionally enforce one or more scopes.
 */
export function authenticateApiKey(...requiredScopes: ApiKeyScope[]) {
  return async (req: ApiKeyAuthenticatedRequest, res: Response, next: NextFunction) => {
    const secret = extractApiKey(req);
    if (!secret) {
      return sendError(
        res,
        401,
        'API_KEY_REQUIRED',
        'Provide a valid API key via X-Api-Key or Authorization: ApiKey <key>.',
      );
    }

    try {
      let key: ApiKey | null;
      try {
        key = await apiKeyService.validateApiKey(secret);
      } catch (err: unknown) {
        if (err instanceof Error && (err as any).code === 'API_KEY_EXPIRED') {
          return sendError(res, 401, 'API_KEY_EXPIRED', 'API key has expired.');
        }
        throw err;
      }
      if (!key) {
        return sendError(res, 401, 'INVALID_API_KEY', 'Invalid or expired API key.');
      }

      const endpoint = req.baseUrl + req.path;
      if (!apiKeyService.checkRateLimit(key.id, endpoint)) {
        apiKeyService.recordUsage(key.id, endpoint, req.method, 429);
        return sendError(
          res,
          429,
          'RATE_LIMIT_EXCEEDED',
          'API key rate limit exceeded for this endpoint. Try again later.',
        );
      }

      if (requiredScopes.length > 0 && !apiKeyService.hasScope(key, requiredScopes)) {
        apiKeyService.recordUsage(key.id, endpoint, req.method, 403);
        return sendError(
          res,
          403,
          'INSUFFICIENT_SCOPE',
          `API key missing required scope(s): ${requiredScopes.join(', ')}`,
        );
      }

      req.apiKey = key;
      res.on('finish', () => {
        apiKeyService.recordUsage(key.id, endpoint, req.method, res.statusCode);
      });

      next();
    } catch {
      return sendError(res, 500, 'INTERNAL_ERROR', 'API key authentication failed.');
    }
  };
}
