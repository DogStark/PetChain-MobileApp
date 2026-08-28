/**
 * Admin API key management routes.
 */

import express from 'express';

import { authenticateJWT, authorizeRoles, type AuthenticatedRequest } from '../../middleware/auth';
import type { ApiKeyScope, CreateApiKeyInput } from '../../models/ApiKey';
import { API_KEY_SCOPES } from '../../models/ApiKey';
import { UserRole } from '../../models/UserRole';
import { ok, sendError } from '../../server/response';
import apiKeyService from '../../services/apiKeyService';

const router = express.Router();

router.use(authenticateJWT, authorizeRoles(UserRole.ADMIN));

/** Available scopes for key creation UI. */
router.get('/scopes', (_req, res) => {
  return res.json(ok({ scopes: API_KEY_SCOPES }));
});

/** List all API keys (no secrets). */
router.get('/', (_req, res) => {
  return res.json(ok(apiKeyService.listApiKeys()));
});

/** Usage analytics aggregated per endpoint. */
router.get('/usage', (req, res) => {
  const apiKeyId = typeof req.query.apiKeyId === 'string' ? req.query.apiKeyId : undefined;
  return res.json(ok(apiKeyService.getUsageSummary(apiKeyId)));
});

/** Create a new API key — plaintext secret returned once. */
router.post('/', async (req: AuthenticatedRequest, res) => {
  const body = req.body as Partial<CreateApiKeyInput>;
  if (!body.name?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
  }
  if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'scopes must be a non-empty array');
  }

  try {
    const result = await apiKeyService.createApiKey(
      {
        name: body.name,
        scopes: body.scopes as ApiKeyScope[],
        expiresAt: body.expiresAt,
      },
      req.user!.id,
    );
    return res
      .status(201)
      .json(ok(result, 'API key created. Store the secret securely — it will not be shown again.'));
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_SCOPES') {
      return sendError(
        res,
        400,
        'INVALID_SCOPES',
        `scopes must be one of: ${API_KEY_SCOPES.join(', ')}`,
      );
    }
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create API key');
  }
});

router.get('/:id', (req, res) => {
  const key = apiKeyService.getApiKey(req.params.id);
  if (!key) {
    return sendError(res, 404, 'NOT_FOUND', 'API key not found');
  }
  return res.json(ok(key));
});

router.get('/:id/usage', (req, res) => {
  const key = apiKeyService.getApiKey(req.params.id);
  if (!key) {
    return sendError(res, 404, 'NOT_FOUND', 'API key not found');
  }
  return res.json(ok(apiKeyService.getUsageSummary(req.params.id)));
});

/** Rotate key — new secret with overlap period for the previous key. */
router.post('/:id/rotate', async (req, res) => {
  const overlapMs =
    typeof req.body?.overlapMs === 'number' && req.body.overlapMs > 0
      ? req.body.overlapMs
      : undefined;

  try {
    const result = await apiKeyService.rotateApiKey(req.params.id, overlapMs);
    return res.json(
      ok(result, 'API key rotated. Old key remains valid until the overlap period ends.'),
    );
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'NOT_FOUND') {
        return sendError(res, 404, 'NOT_FOUND', 'API key not found');
      }
      if (err.message === 'ALREADY_REVOKED') {
        return sendError(res, 400, 'ALREADY_REVOKED', 'Cannot rotate a revoked key');
      }
    }
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to rotate API key');
  }
});

/** Revoke an API key immediately. */
router.delete('/:id', (req, res) => {
  const key = apiKeyService.revokeApiKey(req.params.id);
  if (!key) {
    return sendError(res, 404, 'NOT_FOUND', 'API key not found');
  }
  return res.json(ok(key, 'API key revoked'));
});

export default router;
