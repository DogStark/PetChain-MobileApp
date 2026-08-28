/**
 * Admin CRUD routes for notification templates.
 * All endpoints require ADMIN role.
 *
 * GET    /api/notification-templates
 * POST   /api/notification-templates
 * GET    /api/notification-templates/:id
 * PATCH  /api/notification-templates/:id
 * DELETE /api/notification-templates/:id
 * POST   /api/notification-templates/preview  — render a template with variables
 */

import express from 'express';

import { authenticateJWT, authorizeRoles, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import { ok, sendError } from '../../server/response';
import {
  createTemplate,
  deleteTemplate,
  getTemplateById,
  interpolate,
  listTemplates,
  resolveTemplate,
  updateTemplate,
} from '../../services/notificationTemplateService';

const router = express.Router();
router.use(authenticateJWT, authorizeRoles(UserRole.ADMIN));

// ─── List ─────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { key, locale, isActive, limit, offset } = req.query as Record<string, string>;
  const result = await listTemplates({
    key,
    locale,
    isActive: isActive !== undefined ? isActive === 'true' : undefined,
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined,
  });
  return res.json(ok(result));
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post('/', async (req: AuthenticatedRequest, res) => {
  const { key, locale, title, body, isActive } = req.body as {
    key?: string;
    locale?: string;
    title?: string;
    body?: string;
    isActive?: boolean;
  };

  if (!key?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'key is required');
  if (!title?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'title is required');
  if (!body?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'body is required');

  try {
    const tmpl = await createTemplate({
      key: key.trim(),
      locale: locale?.toLowerCase() ?? 'en',
      title: title.trim(),
      body: body.trim(),
      isActive,
      createdBy: req.user!.id,
    });
    return res.status(201).json(ok(tmpl));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create template';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return sendError(
        res,
        409,
        'CONFLICT',
        `Template already exists for key "${key}" and locale "${locale ?? 'en'}"`,
      );
    }
    return sendError(res, 500, 'INTERNAL_ERROR', msg);
  }
});

// ─── Get by ID ────────────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const tmpl = await getTemplateById(req.params.id);
  if (!tmpl) return sendError(res, 404, 'NOT_FOUND', 'Template not found');
  return res.json(ok(tmpl));
});

// ─── Update ───────────────────────────────────────────────────────────────────

router.patch('/:id', async (req, res) => {
  const { title, body, isActive } = req.body as {
    title?: string;
    body?: string;
    isActive?: boolean;
  };

  const tmpl = await updateTemplate(req.params.id, { title, body, isActive });
  if (!tmpl) return sendError(res, 404, 'NOT_FOUND', 'Template not found');
  return res.json(ok(tmpl));
});

// ─── Delete ───────────────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  const deleted = await deleteTemplate(req.params.id);
  if (!deleted) return sendError(res, 404, 'NOT_FOUND', 'Template not found');
  return res.json(ok(null, 'Template deleted'));
});

// ─── Preview (render with variables) ─────────────────────────────────────────

router.post('/preview', async (req, res) => {
  const { key, locale, vars } = req.body as {
    key?: string;
    locale?: string;
    vars?: Record<string, string>;
  };

  if (!key?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'key is required');

  try {
    const rendered = await resolveTemplate(key.trim(), vars ?? {}, locale ?? 'en');
    return res.json(ok(rendered));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Preview failed';
    const code = msg.startsWith('Missing template variables')
      ? 'MISSING_VARIABLES'
      : msg.startsWith('No notification template')
        ? 'NOT_FOUND'
        : 'INTERNAL_ERROR';
    return sendError(res, code === 'NOT_FOUND' ? 404 : 400, code, msg);
  }
});

export default router;
