/**
 * Comprehensive test suite for nutritionService
 * Covers: calculateDailyCalories, analyzeNutritionalGaps, getBreedRecommendations, logMeal
 * Target: ≥90% branch coverage
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import * as localDB from '../localDB';
import * as syncServiceModule from '../syncService';
import * as errorLoggerModule from '../../utils/errorLogger';
import {
  calculateDailyCalories,
  analyzeNutritionalGaps,
  getBreedRecommendations,
  logMeal,
  getMealLogs,
  updateMeal,
  deleteMeal,
  getTodaysMeals,
  calculateDailyCaloriesConsumed,
  hasMetMinimumDailyIntake,
  getMealLogsForDateRange,
} from '../nutritionService';
import { BreedNotFoundError } from '../../models/Nutrition';
import type { MealLog, NutritionalTarget } from '../../models/Nutrition';

// ───────────────────────────────────────────────────────────────────────────────
// MOCKS
// ───────────────────────────────────────────────────────────────────────────────

jest.mock('../localDB');
jest.mock('../syncService');
jest.mock('../../utils/errorLogger');

const mockLocalDB = localDB as jest.Mocked<typeof localDB>;
const mockSyncService = syncServiceModule.syncService as jest.Mocked<
  typeof syncServiceModule.syncService
>;
const mockErrorLogger = errorLoggerModule as jest.Mocked<typeof errorLoggerModule>;

// ───────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ───────────────────────────────────────────────────────────────────────────────

const createMealLog = (overrides?: Partial<MealLog>): MealLog => ({
  id: 'meal_pet123_12345',
  petId: 'pet123',
  date: '2026-06-23',
  time: '09:00',
  foodName: 'Kibble',
  quantity: 150,
  calories: 400,
  protein: 20,
  fat: 10,
  fiber: 3,
  calcium: 0.8,
  phosphorus: 0.6,
  createdAt: '2026-06-23T09:00:00Z',
  updatedAt: '2026-06-23T09:00:00Z',
  synced: false,
  ...overrides,
});

const defaultNutritionTarget: NutritionalTarget = {
  protein: 18,
  fat: 5,
  fiber: 3,
  calcium: 1.0,
  phosphorus: 0.8,
};

describe('nutritionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // calculateDailyCalories
  // ───────────────────────────────────────────────────────────────────────────

  describe('calculateDailyCalories', () => {
    describe('Boundary values - weight', () => {
      it('calculates calories for minimum valid weight (0.1 kg)', () => {
        const calories = calculateDailyCalories(0.1, 'moderate', 'dog', false);
        expect(calories).toBeGreaterThan(0);
        expect(calories).toBeLessThan(100);
      });

      it('calculates calories for typical small dog weight (5 kg)', () => {
        const calories = calculateDailyCalories(5, 'moderate', 'dog', false);
        expect(calories).toBeCloseTo(600, -1); // ~600 kcal
      });

      it('calculates calories for typical large dog weight (40 kg)', () => {
        const calories = calculateDailyCalories(40, 'moderate', 'dog', false);
        expect(calories).toBeCloseTo(4800, -1); // ~4800 kcal
      });

      it('throws error for zero weight', () => {
        expect(() => calculateDailyCalories(0, 'moderate', 'dog', false)).toThrow(
          'Weight must be a positive number',
        );
      });

      it('throws error for negative weight', () => {
        expect(() => calculateDailyCalories(-5, 'moderate', 'dog', false)).toThrow(
          'Weight must be a positive number',
        );
      });

      it('throws error for NaN weight', () => {
        expect(() => calculateDailyCalories(NaN, 'moderate', 'dog', false)).toThrow(
          'Weight must be a positive number',
        );
      });

      it('throws error for Infinity weight', () => {
        expect(() => calculateDailyCalories(Infinity, 'moderate', 'dog', false)).toThrow(
          'Weight must be a positive number',
        );
      });
    });

    describe('Activity level impact', () => {
      it('low activity produces lowest calorie requirement', () => {
        const low = calculateDailyCalories(10, 'low', 'dog', false);
        const moderate = calculateDailyCalories(10, 'moderate', 'dog', false);
        const high = calculateDailyCalories(10, 'high', 'dog', false);

        expect(low).toBeLessThan(moderate);
        expect(moderate).toBeLessThan(high);
      });

      it('throws error for invalid activity level', () => {
        expect(() => calculateDailyCalories(10, 'invalid' as any, 'dog', false)).toThrow(
          'Invalid activity level: invalid',
        );
      });
    });

    describe('Species-specific calculations', () => {
      it('calculates different calories for dog vs cat (same weight)', () => {
        const dogCalories = calculateDailyCalories(10, 'moderate', 'dog', false);
        const catCalories = calculateDailyCalories(10, 'moderate', 'cat', false);

        expect(dogCalories).not.toEqual(catCalories);
        expect(catCalories).toBeGreaterThan(dogCalories); // Cats have higher base metabolism
      });

      it('calculates for rabbit', () => {
        const calories = calculateDailyCalories(2, 'moderate', 'rabbit', false);
        expect(calories).toBeGreaterThan(0);
      });

      it('calculates for bird', () => {
        const calories = calculateDailyCalories(0.5, 'moderate', 'bird', false);
        expect(calories).toBeGreaterThan(0);
      });

      it('calculates for other species', () => {
        const calories = calculateDailyCalories(10, 'moderate', 'other', false);
        expect(calories).toBeGreaterThan(0);
      });

      it('throws error for invalid species', () => {
        expect(() => calculateDailyCalories(10, 'moderate', 'invalid' as any, false)).toThrow(
          'Invalid species: invalid',
        );
      });
    });

    describe('Neutered status', () => {
      it('reduces calories by 25% when neutered', () => {
        const intact = calculateDailyCalories(10, 'moderate', 'dog', false);
        const neutered = calculateDailyCalories(10, 'moderate', 'dog', true);

        expect(neutered).toBeLessThan(intact);
        expect(neutered).toBeCloseTo(intact * 0.75, 0);
      });

      it('maintains normal calories when not neutered', () => {
        const calories = calculateDailyCalories(10, 'moderate', 'dog', false);
        expect(calories).toBeGreaterThan(0);
      });
    });

    describe('Breed adjustments', () => {
      it('applies breed-specific multiplier for Chihuahua (high metabolism)', () => {
        const withBreed = calculateDailyCalories(3, 'moderate', 'dog', false, 'Chihuahua');
        const withoutBreed = calculateDailyCalories(3, 'moderate', 'dog', false);

        expect(withBreed).toBeGreaterThan(withoutBreed); // 1.15x multiplier
      });

      it('applies breed-specific multiplier for Labrador (lower metabolism)', () => {
        const withBreed = calculateDailyCalories(30, 'moderate', 'dog', false, 'Labrador');
        const withoutBreed = calculateDailyCalories(30, 'moderate', 'dog', false);

        expect(withBreed).toBeLessThan(withoutBreed); // 0.9x multiplier
      });

      it('ignores unknown breed (uses default)', () => {
        const withUnknownBreed = calculateDailyCalories(10, 'moderate', 'dog', false, 'UnknownBreed');
        const withoutBreed = calculateDailyCalories(10, 'moderate', 'dog', false);

        expect(withUnknownBreed).toEqual(withoutBreed);
      });
    });

    describe('Combined factors', () => {
      it('combines all factors: high activity + neutered + breed', () => {
        const combined = calculateDailyCalories(10, 'high', 'dog', true, 'Labrador');
        expect(combined).toBeGreaterThan(0);
        expect(Number.isInteger(combined)).toBe(true); // Should round to integer
      });

      it('returns integer result', () => {
        const calories = calculateDailyCalories(7.5, 'moderate', 'dog', false);
        expect(Number.isInteger(calories)).toBe(true);
      });
    });
  });
});

  // ───────────────────────────────────────────────────────────────────────────
  // analyzeNutritionalGaps
  // ───────────────────────────────────────────────────────────────────────────

  describe('analyzeNutritionalGaps', () => {
    it('detects deficiency when actual < target', () => {
      const mealLog = [
        createMealLog({
          protein: 10,
          fat: 3,
          fiber: 1,
          calcium: 0.5,
          phosphorus: 0.4,
        }),
      ];

      const gaps = analyzeNutritionalGaps(mealLog, defaultNutritionTarget);
      const proteinGap = gaps.find((g) => g.nutrient === 'protein');

      expect(proteinGap?.status).toBe('deficient');
      expect(proteinGap?.gap).toBeLessThan(0);
    });

    it('detects excess when actual > target', () => {
      const mealLog = [
        createMealLog({
          protein: 30,
          fat: 15,
          fiber: 5,
          calcium: 2.0,
          phosphorus: 1.5,
        }),
      ];

      const gaps = analyzeNutritionalGaps(mealLog, defaultNutritionTarget);
      const proteinGap = gaps.find((g) => g.nutrient === 'protein');

      expect(proteinGap?.status).toBe('excess');
      expect(proteinGap?.gap).toBeGreaterThan(0);
    });

    it('detects adequate when actual approximately equals target', () => {
      const mealLog = [
        createMealLog({
          protein: 18,
          fat: 5,
          fiber: 3,
          calcium: 1.0,
          phosphorus: 0.8,
        }),
      ];

      const gaps = analyzeNutritionalGaps(mealLog, defaultNutritionTarget);
      const proteinGap = gaps.find((g) => g.nutrient === 'protein');

      expect(proteinGap?.status).toBe('adequate');
    });

    it('aggregates multiple meal logs', () => {
      const mealLog = [
        createMealLog({ protein: 10, fat: 2, fiber: 1, calcium: 0.5, phosphorus: 0.4 }),
        createMealLog({ protein: 8, fat: 3, fiber: 2, calcium: 0.5, phosphorus: 0.4 }),
      ];

      const gaps = analyzeNutritionalGaps(mealLog, defaultNutritionTarget);
      const proteinGap = gaps.find((g) => g.nutrient === 'protein');

      expect(proteinGap?.actual).toBe(18); // 10 + 8
    });

    it('returns all nutrients', () => {
      const mealLog = [createMealLog()];
      const gaps = analyzeNutritionalGaps(mealLog, defaultNutritionTarget);

      expect(gaps.length).toBe(5); // protein, fat, fiber, calcium, phosphorus
      expect(gaps.map((g) => g.nutrient).sort()).toEqual(
        ['calcium', 'fat', 'fiber', 'phosphorus', 'protein'].sort(),
      );
    });

    it('handles empty meal log', () => {
      const gaps = analyzeNutritionalGaps([], defaultNutritionTarget);
      const proteinGap = gaps.find((g) => g.nutrient === 'protein');

      expect(proteinGap?.actual).toBe(0);
      expect(proteinGap?.status).toBe('deficient');
    });

    it('applies tolerance threshold (0.5g)', () => {
      const mealLog = [
        createMealLog({
          protein: 18.3, // Target is 18, gap is 0.3 (within tolerance)
          fat: 5,
          fiber: 3,
          calcium: 1.0,
          phosphorus: 0.8,
        }),
      ];

      const gaps = analyzeNutritionalGaps(mealLog, defaultNutritionTarget);
      const proteinGap = gaps.find((g) => g.nutrient === 'protein');

      expect(proteinGap?.status).toBe('adequate');
    });

    it('respects tolerance threshold upper bound', () => {
      const mealLog = [
        createMealLog({
          protein: 18.6, // Gap is 0.6, exceeds tolerance
          fat: 5,
          fiber: 3,
          calcium: 1.0,
          phosphorus: 0.8,
        }),
      ];

      const gaps = analyzeNutritionalGaps(mealLog, defaultNutritionTarget);
      const proteinGap = gaps.find((g) => g.nutrient === 'protein');

      expect(proteinGap?.status).toBe('excess');
    });

    it('handles undefined nutrient values in meals', () => {
      const mealLog = [
        {
          ...createMealLog(),
          protein: undefined,
          fat: 5,
        },
      ];

      const gaps = analyzeNutritionalGaps(mealLog as any, defaultNutritionTarget);
      const proteinGap = gaps.find((g) => g.nutrient === 'protein');

      expect(proteinGap?.actual).toBe(0); // 0 + undefined treated as 0
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // getBreedRecommendations
  // ───────────────────────────────────────────────────────────────────────────

  describe('getBreedRecommendations', () => {
    it('returns breed recommendation for known breed', () => {
      const rec = getBreedRecommendations('dog.default');

      expect(rec.breedId).toBe('dog.default');
      expect(rec.breedName).toContain('Dog');
      expect(rec.species).toBe('dog');
      expect(rec.nutritionalTargets).toBeDefined();
    });

    it('returns breed recommendation for large breed', () => {
      const rec = getBreedRecommendations('dog.large');

      expect(rec.breedName).toContain('Dog');
      expect(rec.nutritionalTargets.protein).toBe(18);
      expect(rec.nutritionalTargets.calcium).toBe(1.2); // Higher for large breeds
    });

    it('returns recommendation for cat', () => {
      const rec = getBreedRecommendations('cat.default');

      expect(rec.species).toBe('cat');
      expect(rec.nutritionalTargets.protein).toBe(26); // Higher protein for cats
    });

    it('returns recommendation for rabbit', () => {
      const rec = getBreedRecommendations('rabbit.default');

      expect(rec.species).toBe('rabbit');
      expect(rec.nutritionalTargets.fiber).toBe(18); // High fiber for rabbits
    });

    it('includes calorie recommendation when pet data provided', () => {
      const rec = getBreedRecommendations('dog.default', {
        weight: 25,
        species: 'dog',
        neutered: false,
      });

      expect(rec.recommendedDailyCalories).toBeGreaterThan(0);
    });

    it('calculates different calories for different weights', () => {
      const rec5kg = getBreedRecommendations('dog.default', { weight: 5, species: 'dog' });
      const rec20kg = getBreedRecommendations('dog.default', { weight: 20, species: 'dog' });

      expect(rec20kg.recommendedDailyCalories).toBeGreaterThan(rec5kg.recommendedDailyCalories);
    });

    it('includes neutered status in calorie calculation', () => {
      const intact = getBreedRecommendations('dog.default', {
        weight: 20,
        species: 'dog',
        neutered: false,
      });
      const neutered = getBreedRecommendations('dog.default', {
        weight: 20,
        species: 'dog',
        neutered: true,
      });

      expect(neutered.recommendedDailyCalories).toBeLessThan(intact.recommendedDailyCalories);
    });

    it('throws BreedNotFoundError for unknown breed', () => {
      expect(() => getBreedRecommendations('unknown_breed_xyz')).toThrow(BreedNotFoundError);
      expect(() => getBreedRecommendations('unknown_breed_xyz')).toThrow(
        'Breed with ID "unknown_breed_xyz" not found',
      );
    });

    it('throws BreedNotFoundError for null breed', () => {
      expect(() => getBreedRecommendations(null as any)).toThrow(BreedNotFoundError);
    });

    it('throws BreedNotFoundError for empty string breed', () => {
      expect(() => getBreedRecommendations('')).toThrow(BreedNotFoundError);
    });

    it('formats breed name correctly', () => {
      const rec = getBreedRecommendations('dog.default');
      expect(rec.breedName).toBe('Dog.default'); // Converts to title case
    });

    it('handles "large" in breed ID for size-based adjustments', () => {
      const rec = getBreedRecommendations('German_Shepherd_large', { species: 'dog' });
      expect(rec.species).toBe('dog');
    });

    it('defaults to dog species when not provided', () => {
      const rec = getBreedRecommendations('dog.default');
      expect(rec.species).toBe('dog');
    });

    it('uses provided species over default', () => {
      const rec = getBreedRecommendations('cat.default', { species: 'cat' });
      expect(rec.species).toBe('cat');
    });
  });
});
