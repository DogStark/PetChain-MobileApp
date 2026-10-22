import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { query } from '../../src/db';
import { ok, sendError } from '../response';

const router = express.Router();
router.use(authenticateJWT);

const VALID_TYPES = ['weight', 'temperature', 'heart_rate', 'activity_level'] as const;
type VitalType = (typeof VALID_TYPES)[number];

function isValidType(t: unknown): t is VitalType {
  return VALID_TYPES.includes(t as VitalType);
}

/** GET /api/vitals?petId=&type=&limit=&from=&to= */
router.get('/', async (req: AuthenticatedRequest, res) => {
  const { petId, type, limit = '100', from, to } = req.query as Record<string, string | undefined>;

  if (!petId) return sendError(res, 400, 'VALIDATION_ERROR', 'petId is required');

  const params: unknown[] = [petId];
  const conditions: string[] = ['pet_id = $1'];

  if (type) {
    if (!isValidType(type)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid vital_type');
    params.push(type);
    conditions.push(`vital_type = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`recorded_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`recorded_at <= $${params.length}`);
  }

  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
  params.push(limitNum);

  const sql = `
    SELECT id, pet_id, recorded_at, vital_type, value, unit, notes
    FROM vitals
    WHERE ${conditions.join(' AND ')}
    ORDER BY recorded_at DESC
    LIMIT $${params.length}
  `;

  const result = await query(sql, params);
  return res.json(ok(result.rows));
});

/** POST /api/vitals */
router.post('/', async (req: AuthenticatedRequest, res) => {
  const { petId, vitalType, value, unit, recordedAt, notes } = req.body as Record<string, unknown>;

  if (!petId || !vitalType || value === undefined || !unit) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'petId, vitalType, value, and unit are required',
    );
  }
  if (!isValidType(vitalType)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid vitalType');

  const result = await query(
    `INSERT INTO vitals (pet_id, vital_type, value, unit, recorded_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, pet_id, recorded_at, vital_type, value, unit, notes`,
    [petId, vitalType, value, unit, recordedAt ?? new Date().toISOString(), notes ?? null],
  );

  return res.status(201).json(ok(result.rows[0], 'Vital recorded'));
});

/** DELETE /api/vitals/:id */
router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const result = await query('DELETE FROM vitals WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rowCount === 0) return sendError(res, 404, 'NOT_FOUND', 'Vital not found');
  return res.json(ok(null, 'Vital deleted'));
});

/** GET /api/vitals/export/csv?petId= */
router.get('/export/csv', async (req: AuthenticatedRequest, res) => {
  const { petId } = req.query as Record<string, string | undefined>;
  if (!petId) return sendError(res, 400, 'VALIDATION_ERROR', 'petId is required');

  const result = await query(
    `SELECT recorded_at, vital_type, value, unit, notes
     FROM vitals WHERE pet_id = $1 ORDER BY recorded_at ASC`,
    [petId],
  );

  const header = 'recorded_at,vital_type,value,unit,notes\n';
  const rows = result.rows
    .map((r) =>
      [r.recorded_at, r.vital_type, r.value, r.unit, (r.notes ?? '').replace(/,/g, ';')].join(','),
    )
    .join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="vitals-${petId}.csv"`);
  return res.send(header + rows);
});

export default router;
