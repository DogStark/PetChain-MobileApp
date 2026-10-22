/**
 * Nutrition routes — Express router for the nutrition tracking feature.
 * Handles feeding logs, nutrition goals, calorie calculations,
 * dietary recommendations, weekly reports, and food database search.
 *
 * Base path: /api/nutrition
 */

import { Router, type Request, type Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import {
  ActivityLevel,
  FoodUnit,
  MealType,
  type CreateNutritionGoalInput,
  type CreateNutritionLogInput,
  type NutritionGoal,
  type NutritionLog,
} from '../../models/NutritionLog';
import {
  calculateRecommendedCalories,
  getDietaryRecommendations,
  getFeedingStatus,
} from '../../services/nutritionService';

const router = Router();

// ─── In-memory store (replace with DB in production) ─────────────────────────

const nutritionLogs: NutritionLog[] = [];
const nutritionGoals: NutritionGoal[] = [];

// ─── Mock food database ───────────────────────────────────────────────────────

const FOOD_DATABASE = [
  {
    id: 'food_001',
    name: 'Royal Canin Adult',
    brand: 'Royal Canin',
    category: 'dry',
    caloriesPer100g: 358,
    proteinPer100g: 25,
    fatPer100g: 14,
    carbsPer100g: 33,
    fiberPer100g: 3.4,
    suitableFor: ['dog'],
  },
  {
    id: 'food_002',
    name: "Hill's Science Diet Adult",
    brand: "Hill's",
    category: 'dry',
    caloriesPer100g: 363,
    proteinPer100g: 18.5,
    fatPer100g: 12.5,
    carbsPer100g: 44,
    fiberPer100g: 2.8,
    suitableFor: ['dog'],
  },
  {
    id: 'food_003',
    name: 'Purina Pro Plan Adult',
    brand: 'Purina',
    category: 'dry',
    caloriesPer100g: 375,
    proteinPer100g: 30,
    fatPer100g: 17,
    carbsPer100g: 30,
    fiberPer100g: 3,
    suitableFor: ['dog'],
  },
  {
    id: 'food_004',
    name: 'Royal Canin Cat Adult',
    brand: 'Royal Canin',
    category: 'dry',
    caloriesPer100g: 340,
    proteinPer100g: 32,
    fatPer100g: 12,
    carbsPer100g: 30,
    fiberPer100g: 5.8,
    suitableFor: ['cat'],
  },
  {
    id: 'food_005',
    name: 'Whiskas Adult Wet Food',
    brand: 'Whiskas',
    category: 'wet',
    caloriesPer100g: 85,
    proteinPer100g: 8,
    fatPer100g: 5,
    carbsPer100g: 3,
    fiberPer100g: 0.5,
    suitableFor: ['cat'],
  },
  {
    id: 'food_006',
    name: 'Pedigree Adult Wet Food',
    brand: 'Pedigree',
    category: 'wet',
    caloriesPer100g: 78,
    proteinPer100g: 7,
    fatPer100g: 4.5,
    carbsPer100g: 4,
    fiberPer100g: 0.8,
    suitableFor: ['dog'],
  },
  {
    id: 'food_007',
    name: 'Milk-Bone Dog Biscuits',
    brand: 'Milk-Bone',
    category: 'treat',
    caloriesPer100g: 380,
    proteinPer100g: 10,
    fatPer100g: 8,
    carbsPer100g: 65,
    fiberPer100g: 2,
    suitableFor: ['dog'],
  },
  {
    id: 'food_008',
    name: 'Temptations Cat Treats',
    brand: 'Temptations',
    category: 'treat',
    caloriesPer100g: 320,
    proteinPer100g: 28,
    fatPer100g: 10,
    carbsPer100g: 40,
    fiberPer100g: 1,
    suitableFor: ['cat'],
  },
  {
    id: 'food_009',
    name: 'Blue Buffalo Life Protection',
    brand: 'Blue Buffalo',
    category: 'dry',
    caloriesPer100g: 370,
    proteinPer100g: 26,
    fatPer100g: 15,
    carbsPer100g: 35,
    fiberPer100g: 4,
    suitableFor: ['dog'],
  },
  {
    id: 'food_010',
    name: 'Iams Proactive Health',
    brand: 'Iams',
    category: 'dry',
    caloriesPer100g: 355,
    proteinPer100g: 22,
    fatPer100g: 13,
    carbsPer100g: 38,
    fiberPer100g: 3,
    suitableFor: ['dog', 'cat'],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function successResponse<T>(data: T, message?: string) {
  return {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
}

function validateMealType(value: string): value is MealType {
  return Object.values(MealType).includes(value as MealType);
}

function validateFoodUnit(value: string): value is FoodUnit {
  return Object.values(FoodUnit).includes(value as FoodUnit);
}

function validateActivityLevel(value: string): value is ActivityLevel {
  return Object.values(ActivityLevel).includes(value as ActivityLevel);
}

// ─── Routes: Nutrition Logs ───────────────────────────────────────────────────

/**
 * GET /api/nutrition/logs
 * Query params: petId (required), date (optional, YYYY-MM-DD)
 */
router.get('/logs', (req: Request, res: Response) => {
  const { petId, date } = req.query as { petId?: string; date?: string };

  if (!petId) {
    res.status(400).json({
      success: false,
      error: { code: 'MISSING_PET_ID', message: 'petId query parameter is required' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  let logs = nutritionLogs.filter((l) => l.petId === petId);
  if (date) {
    logs = logs.filter((l) => l.date === date);
  }

  // Sort by date desc, then by createdAt desc
  logs.sort((a, b) => {
    const dateDiff = b.date.localeCompare(a.date);
    if (dateDiff !== 0) return dateDiff;
    return b.createdAt.localeCompare(a.createdAt);
  });

  res.json(successResponse(logs));
});

/**
 * GET /api/nutrition/logs/:id
 */
router.get('/logs/:id', (req: Request, res: Response) => {
  const log = nutritionLogs.find((l) => l.id === req.params.id);
  if (!log) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Nutrition log not found' },
      timestamp: new Date().toISOString(),
    });
    return;
  }
  res.json(successResponse(log));
});

/**
 * POST /api/nutrition/logs
 * Body: CreateNutritionLogInput
 */
router.post('/logs', (req: Request, res: Response) => {
  const body = req.body as CreateNutritionLogInput;

  // Validation
  if (!body.petId || !body.date || !body.foodName || body.amount == null || body.calories == null) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'petId, date, foodName, amount, and calories are required',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (!validateMealType(body.mealType)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `mealType must be one of: ${Object.values(MealType).join(', ')}`,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (!validateFoodUnit(body.unit)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `unit must be one of: ${Object.values(FoodUnit).join(', ')}`,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (body.amount <= 0 || body.calories < 0) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'amount must be > 0 and calories must be >= 0' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const now = new Date().toISOString();
  const log: NutritionLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    petId: body.petId,
    date: body.date,
    mealType: body.mealType,
    foodName: body.foodName,
    brand: body.brand,
    amount: body.amount,
    unit: body.unit,
    calories: body.calories,
    protein: body.protein,
    fat: body.fat,
    carbs: body.carbs,
    fiber: body.fiber,
    notes: body.notes,
    createdAt: now,
    updatedAt: now,
  };

  nutritionLogs.push(log);
  res.status(201).json(successResponse(log, 'Nutrition log created'));
});

/**
 * PUT /api/nutrition/logs/:id
 * Body: UpdateNutritionLogInput
 */
router.put('/logs/:id', (req: Request, res: Response) => {
  const idx = nutritionLogs.findIndex((l) => l.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Nutrition log not found' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const updated: NutritionLog = {
    ...nutritionLogs[idx],
    ...req.body,
    id: nutritionLogs[idx].id,
    petId: nutritionLogs[idx].petId,
    createdAt: nutritionLogs[idx].createdAt,
    updatedAt: new Date().toISOString(),
  };

  nutritionLogs[idx] = updated;
  res.json(successResponse(updated, 'Nutrition log updated'));
});

/**
 * DELETE /api/nutrition/logs/:id
 */
router.delete('/logs/:id', (req: Request, res: Response) => {
  const idx = nutritionLogs.findIndex((l) => l.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Nutrition log not found' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  nutritionLogs.splice(idx, 1);
  res.json(successResponse(null, 'Nutrition log deleted'));
});

// ─── Routes: Nutrition Goals ──────────────────────────────────────────────────

/**
 * GET /api/nutrition/goals/:petId
 */
router.get('/goals/:petId', (req: Request, res: Response) => {
  const goal = nutritionGoals.find((g) => g.petId === req.params.petId);
  if (!goal) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Nutrition goal not found for this pet' },
      timestamp: new Date().toISOString(),
    });
    return;
  }
  res.json(successResponse(goal));
});

/**
 * POST /api/nutrition/goals
 * Body: CreateNutritionGoalInput
 */
router.post('/goals', (req: Request, res: Response) => {
  const body = req.body as CreateNutritionGoalInput;

  if (!body.petId || body.dailyCalories == null) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'petId and dailyCalories are required' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (!validateActivityLevel(body.activityLevel)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `activityLevel must be one of: ${Object.values(ActivityLevel).join(', ')}`,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Remove existing goal for this pet (upsert)
  const existingIdx = nutritionGoals.findIndex((g) => g.petId === body.petId);
  const goal: NutritionGoal = {
    id: existingIdx >= 0 ? nutritionGoals[existingIdx].id : `goal_${Date.now()}`,
    petId: body.petId,
    dailyCalories: body.dailyCalories,
    dailyProteinG: body.dailyProteinG,
    dailyFatG: body.dailyFatG,
    dailyCarbsG: body.dailyCarbsG,
    weightKg: body.weightKg,
    activityLevel: body.activityLevel,
    healthConditions: body.healthConditions ?? [],
    notes: body.notes,
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    nutritionGoals[existingIdx] = goal;
  } else {
    nutritionGoals.push(goal);
  }

  res.status(201).json(successResponse(goal, 'Nutrition goal saved'));
});

/**
 * PUT /api/nutrition/goals/:petId
 */
router.put('/goals/:petId', (req: Request, res: Response) => {
  const idx = nutritionGoals.findIndex((g) => g.petId === req.params.petId);
  if (idx === -1) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Nutrition goal not found for this pet' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const updated: NutritionGoal = {
    ...nutritionGoals[idx],
    ...req.body,
    id: nutritionGoals[idx].id,
    petId: nutritionGoals[idx].petId,
    updatedAt: new Date().toISOString(),
  };

  nutritionGoals[idx] = updated;
  res.json(successResponse(updated, 'Nutrition goal updated'));
});

// ─── Routes: Calorie Calculator ───────────────────────────────────────────────

/**
 * POST /api/nutrition/calculate-calories
 * Body: { weightKg, species, activityLevel, healthConditions? }
 */
router.post('/calculate-calories', (req: Request, res: Response) => {
  const {
    weightKg,
    species,
    activityLevel,
    healthConditions = [],
  } = req.body as {
    weightKg: number;
    species: string;
    activityLevel: string;
    healthConditions?: string[];
  };

  if (!weightKg || !species || !activityLevel) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'weightKg, species, and activityLevel are required',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (!validateActivityLevel(activityLevel)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `activityLevel must be one of: ${Object.values(ActivityLevel).join(', ')}`,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const recommended = calculateRecommendedCalories(
    weightKg,
    species,
    activityLevel as ActivityLevel,
    healthConditions,
  );

  res.json(
    successResponse({
      recommendedDailyCalories: recommended,
      weightKg,
      species,
      activityLevel,
      healthConditions,
    }),
  );
});

// ─── Routes: Dietary Recommendations ─────────────────────────────────────────

/**
 * GET /api/nutrition/recommendations
 * Query params: species, breed, healthConditions (comma-separated)
 */
router.get('/recommendations', (req: Request, res: Response) => {
  const {
    species,
    breed = '',
    healthConditions = '',
  } = req.query as {
    species?: string;
    breed?: string;
    healthConditions?: string;
  };

  if (!species) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'species query parameter is required' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const conditions = healthConditions
    ? healthConditions
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
    : [];

  const recommendations = getDietaryRecommendations(species, breed, conditions);
  res.json(successResponse({ species, breed, healthConditions: conditions, recommendations }));
});

// ─── Routes: Daily Summary ────────────────────────────────────────────────────

/**
 * GET /api/nutrition/summary/daily
 * Query params: petId, date (YYYY-MM-DD)
 */
router.get('/summary/daily', (req: Request, res: Response) => {
  const { petId, date } = req.query as { petId?: string; date?: string };

  if (!petId || !date) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'petId and date are required' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const logs = nutritionLogs.filter((l) => l.petId === petId && l.date === date);
  const goal = nutritionGoals.find((g) => g.petId === petId);

  const totalCalories = logs.reduce((s, l) => s + l.calories, 0);
  const totalProteinG = logs.reduce((s, l) => s + (l.protein ?? 0), 0);
  const totalFatG = logs.reduce((s, l) => s + (l.fat ?? 0), 0);
  const totalCarbsG = logs.reduce((s, l) => s + (l.carbs ?? 0), 0);
  const status = getFeedingStatus(totalCalories, goal?.dailyCalories ?? 0);

  res.json(
    successResponse({
      date,
      petId,
      totalCalories,
      totalProteinG: Math.round(totalProteinG * 10) / 10,
      totalFatG: Math.round(totalFatG * 10) / 10,
      totalCarbsG: Math.round(totalCarbsG * 10) / 10,
      mealCount: logs.length,
      logs,
      goal: goal ?? null,
      status,
    }),
  );
});

// ─── Routes: Weekly Report ────────────────────────────────────────────────────

/**
 * GET /api/nutrition/reports/weekly
 * Query params: petId, weekStart (YYYY-MM-DD, Monday)
 */
router.get('/reports/weekly', (req: Request, res: Response) => {
  const { petId, weekStart } = req.query as { petId?: string; weekStart?: string };

  if (!petId || !weekStart) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'petId and weekStart are required' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const start = new Date(weekStart);
  if (isNaN(start.getTime())) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'weekStart must be a valid date (YYYY-MM-DD)' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const goal = nutritionGoals.find((g) => g.petId === petId);
  const dailySummaries = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayLogs = nutritionLogs.filter((l) => l.petId === petId && l.date === dateStr);

    const totalCalories = dayLogs.reduce((s, l) => s + l.calories, 0);
    const totalProteinG = dayLogs.reduce((s, l) => s + (l.protein ?? 0), 0);
    const totalFatG = dayLogs.reduce((s, l) => s + (l.fat ?? 0), 0);
    const totalCarbsG = dayLogs.reduce((s, l) => s + (l.carbs ?? 0), 0);

    dailySummaries.push({
      date: dateStr,
      totalCalories,
      totalProteinG: Math.round(totalProteinG * 10) / 10,
      totalFatG: Math.round(totalFatG * 10) / 10,
      totalCarbsG: Math.round(totalCarbsG * 10) / 10,
      mealCount: dayLogs.length,
      status: getFeedingStatus(totalCalories, goal?.dailyCalories ?? 0),
    });
  }

  const weekEnd = new Date(start);
  weekEnd.setDate(start.getDate() + 6);

  const daysWithLogs = dailySummaries.filter((s) => s.mealCount > 0);
  const totalDays = daysWithLogs.length || 1;

  const avgDailyCalories = daysWithLogs.reduce((s, d) => s + d.totalCalories, 0) / totalDays;
  const avgDailyProteinG = daysWithLogs.reduce((s, d) => s + d.totalProteinG, 0) / totalDays;
  const avgDailyFatG = daysWithLogs.reduce((s, d) => s + d.totalFatG, 0) / totalDays;
  const avgDailyCarbsG = daysWithLogs.reduce((s, d) => s + d.totalCarbsG, 0) / totalDays;

  const daysOnTrack = dailySummaries.filter((s) => s.status === 'on_track').length;
  const daysUnder = dailySummaries.filter((s) => s.status === 'under').length;
  const daysOver = dailySummaries.filter((s) => s.status === 'over').length;

  let recommendation = '';
  if (daysOnTrack >= 5) {
    recommendation = "Great job! Your pet's nutrition is well-balanced this week.";
  } else if (daysOver >= 4) {
    recommendation = `Your pet was overfed on ${daysOver} days. Consider reducing portion sizes.`;
  } else if (daysUnder >= 4) {
    recommendation = `Your pet was underfed on ${daysUnder} days. Ensure consistent daily feeding.`;
  } else {
    recommendation = `Average daily intake was ${Math.round(avgDailyCalories)} kcal. Keep monitoring.`;
  }

  res.json(
    successResponse({
      petId,
      weekStart,
      weekEnd: weekEnd.toISOString().slice(0, 10),
      dailySummaries,
      avgDailyCalories: Math.round(avgDailyCalories),
      avgDailyProteinG: Math.round(avgDailyProteinG * 10) / 10,
      avgDailyFatG: Math.round(avgDailyFatG * 10) / 10,
      avgDailyCarbsG: Math.round(avgDailyCarbsG * 10) / 10,
      daysOnTrack,
      daysUnder,
      daysOver,
      recommendation,
    }),
  );
});

// ─── Routes: Food Database Search ─────────────────────────────────────────────

/**
 * GET /api/nutrition/foods/search
 * Query params: q (search query), species (optional filter)
 */
router.get('/foods/search', (req: Request, res: Response) => {
  const { q = '', species } = req.query as { q?: string; species?: string };

  let results = FOOD_DATABASE;

  if (q.trim()) {
    const query = q.toLowerCase().trim();
    results = results.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        (item.brand?.toLowerCase().includes(query) ?? false) ||
        item.category.toLowerCase().includes(query),
    );
  }

  if (species) {
    results = results.filter((item) => item.suitableFor.includes(species.toLowerCase()));
  }

  res.json(successResponse(results));
});

export default router;
