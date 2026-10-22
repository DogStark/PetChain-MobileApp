import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { search, type SearchIndex, INDICES } from '../../services/searchService';
import { ok, sendError } from '../response';

const router = express.Router();
router.use(authenticateJWT);

// GET /api/search?q=&index=&from=&size=&<field>=<value>
router.get('/', async (req: AuthenticatedRequest, res) => {
  const q = req.query as Record<string, string | undefined>;
  const query = q.q?.trim();
  if (!query) return sendError(res, 400, 'VALIDATION_ERROR', 'q parameter required');

  const validIndices = Object.values(INDICES) as SearchIndex[];
  const indices = q.index
    ? q.index.split(',').filter((i): i is SearchIndex => validIndices.includes(i as SearchIndex))
    : undefined;

  const from = q.from ? parseInt(q.from) : 0;
  const size = q.size ? Math.min(parseInt(q.size), 100) : 20;

  // Any extra query params become field filters (e.g. ?petId=xxx)
  const reserved = new Set(['q', 'index', 'from', 'size']);
  const filters: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(q)) {
    if (!reserved.has(key) && val) filters[key] = val;
  }

  try {
    const result = await search(query, { indices, filters, from, size });
    return res.json(ok(result));
  } catch (e) {
    return sendError(res, 503, 'SEARCH_UNAVAILABLE', 'Search service unavailable');
  }
});

export default router;
