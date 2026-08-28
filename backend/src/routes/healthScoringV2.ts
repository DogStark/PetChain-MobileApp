import express, { type Request, type Response } from 'express';

import { authenticateJWT as authenticate } from '../../middleware/auth';
import healthScoringServiceV2 from '../../services/healthScoringServiceV2';
import { query } from '../db';

const router = express.Router();

/**
 * Calculate health score for a pet using v2 algorithm
 * GET /api/health-scoring/v2/pet/:petId
 */
router.get('/v2/pet/:petId', authenticate, async (req: Request, res: Response) => {
  try {
    // Verify user owns the pet
    const petResult = await query('SELECT * FROM pets WHERE id = $1 AND owner_id = $2', [
      String(req.params.petId),
      (req as any).user.id,
    ]);

    if (petResult.rows.length === 0) {
      return res.status(403).json({ error: 'Pet not found or not owned by user' });
    }

    const scoreExplanation = await healthScoringServiceV2.calculateHealthScore(
      String(req.params.petId),
    );

    res.json(scoreExplanation);
  } catch (error) {
    console.error('Error calculating health score:', error);
    res.status(500).json({ error: 'Failed to calculate health score' });
  }
});

/**
 * Analyze species health data to derive weights
 * POST /api/health-scoring/v2/analyze-species
 */
router.post('/v2/analyze-species', authenticate, async (req: Request, res: Response) => {
  try {
    const { species, breed } = req.body;

    if (!species) {
      return res.status(400).json({ error: 'species is required' });
    }

    const weights = await healthScoringServiceV2.analyzeSpeciesData(species, breed);

    res.json(weights);
  } catch (error) {
    console.error('Error analyzing species data:', error);
    res.status(500).json({ error: 'Failed to analyze species data' });
  }
});

/**
 * Compare v1 and v2 algorithm scores for A/B testing
 * GET /api/health-scoring/v2/compare/:petId
 */
router.get('/v2/compare/:petId', authenticate, async (req: Request, res: Response) => {
  try {
    // Verify user owns the pet
    const petResult = await query('SELECT * FROM pets WHERE id = $1 AND owner_id = $2', [
      String(req.params.petId),
      (req as any).user.id,
    ]);

    if (petResult.rows.length === 0) {
      return res.status(403).json({ error: 'Pet not found or not owned by user' });
    }

    const comparison = await healthScoringServiceV2.compareAlgorithms(String(req.params.petId));

    res.json(comparison);
  } catch (error) {
    console.error('Error comparing algorithms:', error);
    res.status(500).json({ error: 'Failed to compare algorithms' });
  }
});

/**
 * Update health score incrementally as new data arrives
 * POST /api/health-scoring/v2/update/:petId
 */
router.post('/v2/update/:petId', authenticate, async (req: Request, res: Response) => {
  try {
    // Verify user owns the pet
    const petResult = await query('SELECT * FROM pets WHERE id = $1 AND owner_id = $2', [
      String(req.params.petId),
      (req as any).user.id,
    ]);

    if (petResult.rows.length === 0) {
      return res.status(403).json({ error: 'Pet not found or not owned by user' });
    }

    const { newFactor } = req.body;

    if (!newFactor) {
      return res.status(400).json({ error: 'newFactor is required' });
    }

    const updatedScore = await healthScoringServiceV2.updateHealthScoreIncremental(
      String(req.params.petId),
      newFactor,
    );

    res.json(updatedScore);
  } catch (error) {
    console.error('Error updating health score:', error);
    res.status(500).json({ error: 'Failed to update health score' });
  }
});

/**
 * Get health score history for a pet
 * GET /api/health-scoring/v2/history/:petId?days=30
 */
router.get('/v2/history/:petId', authenticate, async (req: Request, res: Response) => {
  try {
    // Verify user owns the pet
    const petResult = await query('SELECT * FROM pets WHERE id = $1 AND owner_id = $2', [
      String(req.params.petId),
      (req as any).user.id,
    ]);

    if (petResult.rows.length === 0) {
      return res.status(403).json({ error: 'Pet not found or not owned by user' });
    }

    const days = parseInt(String(req.query.days || '30'), 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const historyResult = await query(
      `SELECT v2_score, v2_explanation, confidence_min, confidence_max, calculated_at
       FROM health_score_history
       WHERE pet_id = $1 AND calculated_at >= $2
       ORDER BY calculated_at ASC`,
      [String(req.params.petId), cutoffDate],
    );

    const history = historyResult.rows.map((row) => ({
      score: row.v2_score,
      date: row.calculated_at,
      explanation: row.v2_explanation,
      confidenceMin: row.confidence_min,
      confidenceMax: row.confidence_max,
    }));

    res.json(history);
  } catch (error) {
    console.error('Error fetching health score history:', error);
    res.status(500).json({ error: 'Failed to fetch health score history' });
  }
});

export default router;
