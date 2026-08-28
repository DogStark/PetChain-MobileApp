import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import {
  eraseUserData,
  exportUserData,
  getConsentHistory,
  logConsent,
  requestDataExport,
  getExportRequest,
  getUserExportRequests,
} from '../../services/dataExportService';
import { ok, sendError } from '../response';

const router = express.Router();
router.use(authenticateJWT);

const CONSENT_CATEGORIES = ['necessary', 'functional', 'analytics', 'marketing'] as const;

// GET /api/privacy/export — download all user data as JSON (immediate)
router.get('/export', (req: AuthenticatedRequest, res) => {
  const data = exportUserData(req.user!.id);
  res.setHeader('Content-Disposition', 'attachment; filename="petchain-data-export.json"');
  res.setHeader('Content-Type', 'application/json');
  return res.json(data);
});

// POST /api/privacy/export — queue data export request (GDPR Article 20)
router.post('/export', (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const userEmail = (user as { email?: string }).email || 'user@example.com';

  const request = requestDataExport(user.id, userEmail);

  return res.status(202).json(
    ok(
      {
        requestId: request.id,
        status: request.status,
        requestedAt: request.requestedAt,
        message:
          'Export request queued. You will receive an email with a download link when ready (expires in 48 hours).',
      },
      'Export request created',
    ),
  );
});

// GET /api/privacy/export/requests — get all export requests for current user
router.get('/export/requests', (req: AuthenticatedRequest, res) => {
  const requests = getUserExportRequests(req.user!.id);
  return res.json(ok(requests));
});

// GET /api/privacy/export/:requestId — get export request status
router.get('/export/:requestId', (req: AuthenticatedRequest, res) => {
  const request = getExportRequest(req.params.requestId);

  if (!request) {
    return sendError(res, 404, 'NOT_FOUND', 'Export request not found');
  }

  if (request.userId !== req.user!.id) {
    return sendError(res, 403, 'FORBIDDEN', 'Access denied');
  }

  return res.json(ok(request));
});

// GET /api/privacy/consent — get current consent state
router.get('/consent', (req: AuthenticatedRequest, res) => {
  const history = getConsentHistory(req.user!.id);
  // Latest entry per category
  const latest: Record<string, boolean> = {};
  for (const entry of history) {
    latest[entry.category] = entry.granted;
  }
  return res.json(ok({ categories: CONSENT_CATEGORIES, consents: latest }));
});

// POST /api/privacy/consent — update consent
router.post('/consent', (req: AuthenticatedRequest, res) => {
  const { consents } = req.body as { consents: Record<string, boolean> };
  if (!consents || typeof consents !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'consents object required');
  }
  for (const [category, granted] of Object.entries(consents)) {
    if (!CONSENT_CATEGORIES.includes(category as (typeof CONSENT_CATEGORIES)[number])) {
      return sendError(res, 400, 'VALIDATION_ERROR', `Unknown category: ${category}`);
    }
    logConsent(req.user!.id, category, Boolean(granted));
  }
  return res.json(ok({ updated: Object.keys(consents) }));
});

// GET /api/privacy/consent/history — audit log
router.get('/consent/history', (req: AuthenticatedRequest, res) => {
  return res.json(ok(getConsentHistory(req.user!.id)));
});

// DELETE /api/privacy/erase — right to erasure
router.delete('/erase', (req: AuthenticatedRequest, res) => {
  eraseUserData(req.user!.id);
  return res.json(ok({ erased: true, userId: req.user!.id }));
});

export default router;
