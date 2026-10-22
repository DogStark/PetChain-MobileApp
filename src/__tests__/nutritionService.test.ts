/**
 * Tests for nutrition service — calorie calculations and recommendation logic.
 * Closes #68
 */

import type { FoodItem, NutritionLog } from '../models/NutritionLog';
import {
  calculateCaloriesFromFood,
  calculateRecommendedCalories,
  getDietaryRecommendations,
  getFeedingStatus,
  sumCalories,
  sumMacro,
} from '../services/nutritionService';

// ─── Mock AsyncStorage ────────────────────────────────────────────────────────

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLog(overrides: Partial<NutritionLog> = {}): NutritionLog {
  return {
    id: 'log_1',
    petId: 'pet_1',
    date: '2026-05-31',
    mealType: 'breakfast',
    foodName: 'Test Food',
    amount: 100,
    unit: 'g',
    calories: 300,
    protein: 20,
    fat: 10,
    carbs: 30,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFoodItem(overrides: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 'food_1',
    name: 'Test Kibble',
    category: 'dry',
    caloriesPer100g: 350,
    proteinPer100g: 25,
    fatPer100g: 14,
    carbsPer100g: 33,
    suitableFor: ['dog'],
    ...overrides,
  };
}

// ─── sumCalories ──────────────────────────────────────────────────────────────

describe('sumCalories', () => {
  it('returns 0 for empty array', () => {
    expect(sumCalories([])).toBe(0);
  });

  it('sums calories from a single log', () => {
    expect(sumCalories([makeLog({ calories: 250 })])).toBe(250);
  });

  it('sums calories from multiple logs', () => {
    const logs = [
      makeLog({ calories: 200 }),
      makeLog({ calories: 150 }),
      makeLog({ calories: 100 }),
    ];
    expect(sumCalories(logs)).toBe(450);
  });

  it('handles logs with 0 calories', () => {
    const logs = [makeLog({ calories: 0 }), makeLog({ calories: 300 })];
    expect(sumCalories(logs)).toBe(300);
  });
});

// ─── sumMacro ─────────────────────────────────────────────────────────────────

describe('sumMacro', () => {
  it('sums protein across logs', () => {
    const logs = [makeLog({ protein: 15 }), makeLog({ protein: 10 })];
    expect(sumMacro(logs, 'protein')).toBe(25);
  });

  it('sums fat across logs', () => {
    const logs = [makeLog({ fat: 8 }), makeLog({ fat: 5 })];
    expect(sumMacro(logs, 'fat')).toBe(13);
  });

  it('sums carbs across logs', () => {
    const logs = [makeLog({ carbs: 20 }), makeLog({ carbs: 15 })];
    expect(sumMacro(logs, 'carbs')).toBe(35);
  });

  it('treats undefined macros as 0', () => {
    const logs = [makeLog({ protein: undefined }), makeLog({ protein: 10 })];
    expect(sumMacro(logs, 'protein')).toBe(10);
  });

  it('returns 0 for empty array', () => {
    expect(sumMacro([], 'protein')).toBe(0);
  });
});

// ─── getFeedingStatus ─────────────────────────────────────────────────────────

describe('getFeedingStatus', () => {
  it('returns on_track when within ±10% of goal', () => {
    expect(getFeedingStatus(500, 500)).toBe('on_track');
    expect(getFeedingStatus(450, 500)).toBe('on_track'); // 90% — boundary
    expect(getFeedingStatus(550, 500)).toBe('on_track'); // 110% — boundary
  });

  it('returns under when below 90% of goal', () => {
    expect(getFeedingStatus(400, 500)).toBe('under'); // 80%
    expect(getFeedingStatus(0, 500)).toBe('under');
    expect(getFeedingStatus(449, 500)).toBe('under'); // just below 90%
  });

  it('returns over when above 110% of goal', () => {
    expect(getFeedingStatus(600, 500)).toBe('over'); // 120%
    expect(getFeedingStatus(551, 500)).toBe('over'); // just above 110%
    expect(getFeedingStatus(1000, 500)).toBe('over');
  });

  it('returns on_track when goal is 0 (no goal set)', () => {
    expect(getFeedingStatus(500, 0)).toBe('on_track');
    expect(getFeedingStatus(0, 0)).toBe('on_track');
  });

  it('handles exact boundary values correctly', () => {
    // 90% of 1000 = 900 → on_track
    expect(getFeedingStatus(900, 1000)).toBe('on_track');
    // 110% of 1000 = 1100 → on_track
    expect(getFeedingStatus(1100, 1000)).toBe('on_track');
    // 89.9% → under
    expect(getFeedingStatus(899, 1000)).toBe('under');
    // 110.1% → over
    expect(getFeedingStatus(1101, 1000)).toBe('over');
  });
});

// ─── calculateRecommendedCalories ────────────────────────────────────────────

describe('calculateRecommendedCalories', () => {
  it('returns 0 for zero or negative weight', () => {
    expect(calculateRecommendedCalories(0, 'dog', 'moderate')).toBe(0);
    expect(calculateRecommendedCalories(-5, 'dog', 'moderate')).toBe(0);
  });

  it('calculates calories for a 10kg dog with moderate activity', () => {
    // RER = 70 × (10 ^ 0.75) = 70 × 5.623 ≈ 393.6
    // moderate multiplier = 1.6 → 393.6 × 1.6 ≈ 630
    const result = calculateRecommendedCalories(10, 'dog', 'moderate');
    expect(result).toBeGreaterThan(600);
    expect(result).toBeLessThan(680);
  });

  it('calculates lower calories for low activity', () => {
    const low = calculateRecommendedCalories(10, 'dog', 'low');
    const moderate = calculateRecommendedCalories(10, 'dog', 'moderate');
    const high = calculateRecommendedCalories(10, 'dog', 'high');
    expect(low).toBeLessThan(moderate);
    expect(moderate).toBeLessThan(high);
  });

  it('applies cat species adjustment (0.9x)', () => {
    const dog = calculateRecommendedCalories(5, 'dog', 'moderate');
    const cat = calculateRecommendedCalories(5, 'cat', 'moderate');
    expect(cat).toBeLessThan(dog);
    expect(cat).toBeCloseTo(dog * 0.9, 0);
  });

  it('reduces calories for obesity condition', () => {
    const normal = calculateRecommendedCalories(10, 'dog', 'moderate');
    const obese = calculateRecommendedCalories(10, 'dog', 'moderate', ['obesity']);
    expect(obese).toBeLessThan(normal);
    expect(obese).toBeCloseTo(normal * 0.8, 0);
  });

  it('reduces calories for diabetes condition', () => {
    const normal = calculateRecommendedCalories(10, 'dog', 'moderate');
    const diabetic = calculateRecommendedCalories(10, 'dog', 'moderate', ['diabetes']);
    expect(diabetic).toBeLessThan(normal);
  });

  it('reduces calories for kidney disease', () => {
    const normal = calculateRecommendedCalories(10, 'dog', 'moderate');
    const kidney = calculateRecommendedCalories(10, 'dog', 'moderate', ['kidney_disease']);
    expect(kidney).toBeLessThan(normal);
  });

  it('increases calories for hyperthyroidism', () => {
    const normal = calculateRecommendedCalories(10, 'dog', 'moderate');
    const hyper = calculateRecommendedCalories(10, 'dog', 'moderate', ['hyperthyroidism']);
    expect(hyper).toBeGreaterThan(normal);
  });

  it('stacks multiple health condition adjustments', () => {
    const normal = calculateRecommendedCalories(10, 'dog', 'moderate');
    const multi = calculateRecommendedCalories(10, 'dog', 'moderate', ['obesity', 'diabetes']);
    expect(multi).toBeLessThan(normal);
  });

  it('scales with weight — heavier pets need more calories', () => {
    const small = calculateRecommendedCalories(5, 'dog', 'moderate');
    const large = calculateRecommendedCalories(30, 'dog', 'moderate');
    expect(large).toBeGreaterThan(small);
  });

  it('returns a positive integer', () => {
    const result = calculateRecommendedCalories(8, 'dog', 'high');
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ─── calculateCaloriesFromFood ────────────────────────────────────────────────

describe('calculateCaloriesFromFood', () => {
  const food = makeFoodItem({ caloriesPer100g: 350 });

  it('calculates calories for grams', () => {
    expect(calculateCaloriesFromFood(food, 100, 'g')).toBe(350);
    expect(calculateCaloriesFromFood(food, 200, 'g')).toBe(700);
    expect(calculateCaloriesFromFood(food, 50, 'g')).toBe(175);
  });

  it('calculates calories for kilograms', () => {
    // 1kg = 1000g → 350 × 10 = 3500
    expect(calculateCaloriesFromFood(food, 1, 'kg')).toBe(3500);
    expect(calculateCaloriesFromFood(food, 0.5, 'kg')).toBe(1750);
  });

  it('calculates calories for ounces', () => {
    // 1oz = 28.35g → 350 × 28.35 / 100 ≈ 99
    const result = calculateCaloriesFromFood(food, 1, 'oz');
    expect(result).toBeGreaterThan(95);
    expect(result).toBeLessThan(105);
  });

  it('calculates calories for cups (approx 120g)', () => {
    // 1 cup ≈ 120g → 350 × 120 / 100 = 420
    expect(calculateCaloriesFromFood(food, 1, 'cup')).toBe(420);
  });

  it('calculates calories for ml (approx 1g)', () => {
    expect(calculateCaloriesFromFood(food, 100, 'ml')).toBe(350);
  });

  it('returns 0 for 0 amount', () => {
    expect(calculateCaloriesFromFood(food, 0, 'g')).toBe(0);
  });
});

// ─── getDietaryRecommendations ────────────────────────────────────────────────

describe('getDietaryRecommendations', () => {
  it('returns at least one recommendation for any pet', () => {
    const tips = getDietaryRecommendations('dog', 'Labrador', []);
    expect(tips.length).toBeGreaterThan(0);
  });

  it('includes Labrador-specific tip for Labrador breed', () => {
    const tips = getDietaryRecommendations('dog', 'Labrador Retriever', []);
    expect(tips.some((t) => t.toLowerCase().includes('labrador'))).toBe(true);
  });

  it('includes cat-specific tip for cats', () => {
    const tips = getDietaryRecommendations('cat', 'Persian', []);
    expect(
      tips.some(
        (t) => t.toLowerCase().includes('carnivore') || t.toLowerCase().includes('taurine'),
      ),
    ).toBe(true);
  });

  it('includes obesity tip when obesity is a health condition', () => {
    const tips = getDietaryRecommendations('dog', 'Beagle', ['obesity']);
    expect(
      tips.some((t) => t.toLowerCase().includes('obes') || t.toLowerCase().includes('calorie')),
    ).toBe(true);
  });

  it('includes diabetes tip when diabetes is a health condition', () => {
    const tips = getDietaryRecommendations('dog', 'Poodle', ['diabetes']);
    expect(
      tips.some(
        (t) => t.toLowerCase().includes('diabet') || t.toLowerCase().includes('blood sugar'),
      ),
    ).toBe(true);
  });

  it('includes kidney disease tip when kidney_disease is a health condition', () => {
    const tips = getDietaryRecommendations('dog', 'Shih Tzu', ['kidney_disease']);
    expect(
      tips.some(
        (t) => t.toLowerCase().includes('kidney') || t.toLowerCase().includes('phosphorus'),
      ),
    ).toBe(true);
  });

  it('includes heart disease tip when heart_disease is a health condition', () => {
    const tips = getDietaryRecommendations('cat', 'Siamese', ['heart_disease']);
    expect(
      tips.some((t) => t.toLowerCase().includes('sodium') || t.toLowerCase().includes('heart')),
    ).toBe(true);
  });

  it('includes allergy tip when allergies is a health condition', () => {
    const tips = getDietaryRecommendations('dog', 'Bulldog', ['allergies']);
    expect(
      tips.some(
        (t) => t.toLowerCase().includes('allergen') || t.toLowerCase().includes('ingredient'),
      ),
    ).toBe(true);
  });

  it('returns a generic tip for unknown species with no conditions', () => {
    const tips = getDietaryRecommendations('rabbit', '', []);
    expect(tips.length).toBeGreaterThan(0);
  });

  it('stacks multiple health condition tips', () => {
    const single = getDietaryRecommendations('dog', 'Poodle', ['obesity']);
    const multi = getDietaryRecommendations('dog', 'Poodle', ['obesity', 'diabetes', 'allergies']);
    expect(multi.length).toBeGreaterThan(single.length);
  });
});
