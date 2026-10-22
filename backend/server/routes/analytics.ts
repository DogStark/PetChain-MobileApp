import express from 'express';

import { authenticateJWT, authorizeRoles } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import { ok, sendError } from '../response';

const router = express.Router();

interface AnalyticsEvent {
  type: 'screen_view' | 'feature_usage' | 'error';
  name: string;
  meta?: Record<string, unknown>;
  timestamp: number;
}

const events: AnalyticsEvent[] = [];

// Analytics events can be posted by any authenticated user
router.post('/events', authenticateJWT, (req, res) => {
  const { type, name, meta, timestamp } = req.body as Partial<AnalyticsEvent>;
  if (!type || !name) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'type and name are required');
  }
  events.push({ type, name, meta, timestamp: timestamp ?? Date.now() });
  return res.status(201).json(ok(null, 'Event recorded'));
});

// Dashboard is restricted to admins
router.get('/dashboard', authenticateJWT, authorizeRoles(UserRole.ADMIN), (_req, res) => {
  const counts: Record<string, Record<string, number>> = {
    screen_view: {},
    feature_usage: {},
    error: {},
  };

  for (const e of events) {
    if (!counts[e.type]) counts[e.type] = {};
    counts[e.type][e.name] = (counts[e.type][e.name] ?? 0) + 1;
  }

  return res.json(
    ok({
      totalEvents: events.length,
      screenViews: counts.screen_view,
      featureUsage: counts.feature_usage,
      errors: counts.error,
    }),
  );
});

export default router;
