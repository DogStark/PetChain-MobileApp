import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import mlPredictionService, { type VitalReading } from '../../services/mlPredictionService';
import { query } from '../../src/db';
import { ok, sendError } from '../response';
import { store, type StoredHealthPredictionAlert } from '../store';

const router = express.Router();
router.use(authenticateJWT);

function canAccessAlert(req: AuthenticatedRequest, alert: StoredHealthPredictionAlert): boolean {
  return req.user!.role === UserRole.ADMIN || alert.ownerId === req.user!.id;
}

function activeDuplicate(
  alert: StoredHealthPredictionAlert,
): StoredHealthPredictionAlert | undefined {
  return [...store.healthPredictionAlerts.values()].find(
    (existing) =>
      existing.petId === alert.petId &&
      existing.predictedIssue === alert.predictedIssue &&
      existing.status === 'active',
  );
}

async function loadPredictionPets(req: AuthenticatedRequest) {
  try {
    const params: unknown[] = [];
    const ownerFilter = req.user!.role === UserRole.ADMIN ? '' : 'WHERE owner_id = $1';
    if (ownerFilter) params.push(req.user!.id);

    const result = await query(
      `SELECT id, owner_id, species
       FROM pets
       ${ownerFilter}`,
      params,
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      ownerId: String(row.owner_id),
      species: row.species ? String(row.species) : undefined,
    }));
  } catch {
    return [...store.pets.values()]
      .filter((pet) => req.user!.role === UserRole.ADMIN || pet.ownerId === req.user!.id)
      .map((pet) => ({ id: pet.id, ownerId: pet.ownerId, species: pet.species }));
  }
}

async function loadVitalsByPet(petIds: string[]): Promise<Map<string, VitalReading[]>> {
  const grouped = new Map<string, VitalReading[]>();
  for (const petId of petIds) grouped.set(petId, []);
  if (!petIds.length) return grouped;

  try {
    const result = await query(
      `SELECT pet_id, vital_type, value, unit, recorded_at
       FROM vitals
       WHERE pet_id = ANY($1)
       ORDER BY recorded_at DESC
       LIMIT 1000`,
      [petIds],
    );

    for (const row of result.rows) {
      const petId = String(row.pet_id);
      const readings = grouped.get(petId) ?? [];
      readings.push({
        petId,
        vitalType: row.vital_type as VitalReading['vitalType'],
        value: Number(row.value),
        unit: row.unit,
        recordedAt: new Date(row.recorded_at).toISOString(),
      });
      grouped.set(petId, readings);
    }
  } catch {
    // Local test/dev environments often run without a database. In that case
    // predictions simply run with empty vitals and will not produce high-risk alerts.
  }

  return grouped;
}

router.get('/', (req: AuthenticatedRequest, res) => {
  const status = (req.query.status as string | undefined) ?? 'active';
  const alerts = [...store.healthPredictionAlerts.values()]
    .filter((alert) => canAccessAlert(req, alert))
    .filter((alert) => (status === 'all' ? true : alert.status === status))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return res.json(ok(alerts));
});

router.post('/run-daily', async (req: AuthenticatedRequest, res) => {
  const pets = await loadPredictionPets(req);
  const vitalsByPet = await loadVitalsByPet(pets.map((pet) => pet.id));
  const generated = mlPredictionService.runDailyPredictions(
    pets.map((pet) => ({
      petId: pet.id,
      ownerId: pet.ownerId,
      species: pet.species,
      vitals: vitalsByPet.get(pet.id) ?? [],
    })),
  );

  const inserted: StoredHealthPredictionAlert[] = [];
  for (const alert of generated) {
    if (activeDuplicate(alert)) continue;
    store.healthPredictionAlerts.set(alert.id, alert);
    inserted.push(alert);
  }

  return res.status(201).json(ok(inserted, 'Predictive health alerts generated'));
});

router.post('/:id/dismiss', (req: AuthenticatedRequest, res) => {
  const alert = store.healthPredictionAlerts.get(req.params.id);
  if (!alert) return sendError(res, 404, 'NOT_FOUND', 'Health alert not found');
  if (!canAccessAlert(req, alert)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to dismiss this alert');
  }

  const { feedback, feedbackNotes } = req.body as {
    feedback?: StoredHealthPredictionAlert['feedback'];
    feedbackNotes?: string;
  };
  const next: StoredHealthPredictionAlert = {
    ...alert,
    status: 'dismissed',
    dismissedAt: new Date().toISOString(),
    feedback,
    feedbackNotes: feedbackNotes?.trim(),
  };
  store.healthPredictionAlerts.set(next.id, next);
  return res.json(ok(next, 'Health alert dismissed'));
});

export default router;
