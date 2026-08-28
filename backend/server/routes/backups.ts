/* eslint-disable @typescript-eslint/no-non-null-assertion */
import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { ok, sendError } from '../response';
import { store, type StoredBackup } from '../store';

const router = express.Router();

router.use(authenticateJWT);

router.get('/me', (req: AuthenticatedRequest, res) => {
  const backup = store.backups.get(req.user!.id);
  if (!backup) {
    return sendError(res, 404, 'NOT_FOUND', 'No backup found for the current user');
  }

  return res.json(ok(backup.payload));
});

router.post('/me', (req: AuthenticatedRequest, res) => {
  const payload = req.body as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Backup payload is required');
  }

  const backup: StoredBackup = {
    userId: req.user!.id,
    createdAt: new Date().toISOString(),
    payload,
  };

  store.backups.set(req.user!.id, backup);
  return res.status(201).json(ok(backup.payload, 'Backup saved'));
});

export default router;
