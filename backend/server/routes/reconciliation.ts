/**
 * Reconciliation Routes
 * Issue #102 — Automated Vet Record Reconciliation
 *
 * POST  /reconciliation/run          — trigger a manual reconciliation run
 * GET   /reconciliation/summary      — get current status + latest report summary
 * GET   /reconciliation/reports      — list all past reports
 * GET   /reconciliation/reports/:id  — get a specific report
 * POST  /reconciliation/scheduler/start  — start the background scheduler
 * POST  /reconciliation/scheduler/stop   — stop the background scheduler
 */

import express from 'express';

import { authenticateJWT, authorizeRoles, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import reconciliationService from '../../services/reconciliationService';
import { ok, sendError } from '../response';

const router = express.Router();

router.use(authenticateJWT);

// ── Manual run (admin only) ───────────────────────────────────────────────────
router.post('/run', authorizeRoles(UserRole.ADMIN, UserRole.VET), async (_req, res) => {
  try {
    const report = await reconciliationService.run();
    return res.status(201).json(ok(report, 'Reconciliation run completed'));
  } catch (error) {
    return sendError(
      res,
      409,
      'RECONCILIATION_IN_PROGRESS',
      error instanceof Error ? error.message : 'Failed to run reconciliation',
    );
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────
router.get('/summary', (_req: AuthenticatedRequest, res) => {
  return res.json(ok(reconciliationService.getSummary()));
});

// ── List reports ──────────────────────────────────────────────────────────────
router.get('/reports', authorizeRoles(UserRole.ADMIN, UserRole.VET), (_req, res) => {
  const reports = reconciliationService.listReports();
  return res.json(ok(reports));
});

// ── Get single report ─────────────────────────────────────────────────────────
router.get('/reports/:id', authorizeRoles(UserRole.ADMIN, UserRole.VET), (req, res) => {
  const report = reconciliationService.getReport(req.params.id);
  if (!report) return sendError(res, 404, 'NOT_FOUND', 'Report not found');
  return res.json(ok(report));
});

// ── Scheduler control (admin only) ────────────────────────────────────────────
router.post(
  '/scheduler/start',
  authorizeRoles(UserRole.ADMIN),
  (req: AuthenticatedRequest, res) => {
    const intervalMs = Number((req.body as { intervalMs?: number })?.intervalMs) || undefined;
    reconciliationService.startScheduler(intervalMs);
    return res.json(ok({ started: true }, 'Reconciliation scheduler started'));
  },
);

router.post('/scheduler/stop', authorizeRoles(UserRole.ADMIN), (_req, res) => {
  reconciliationService.stopScheduler();
  return res.json(ok({ stopped: true }, 'Reconciliation scheduler stopped'));
});

export default router;
