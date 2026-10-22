/**
 * Nutrition-related models for pet meal tracking and dietary analysis
 */

export type Species = 'dog' | 'cat' | 'bird' | 'rabbit' | 'other';
export type ActivityLevel = 'low' | 'moderate' | 'high';

/**
 * Calorie requirement formula: Base × Weight × Activity Factor
 * Base values (kcal/kg) by species for sedentary adult
 */
export const CALORIE_BASE_BY_SPECIES: Record<Species, number> = {
  dog: 80,
  cat: 60,
  bird: 300, // Per kg, but birds typically weigh much less
  rabbit: 100,
  other: 80,
};

/**
 * Activity level multipliers applied to base calorie calculation
 */
export const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  low: 1.2,
  moderate: 1.5,
  high: 1.8,
};

/**
 * Neutered status multiplier (reduces calorie needs by 25%)
 */
export const NEUTERED_MULTIPLIER = 0.75;

/**
 * Breed-specific calorie adjustments (multiplier on base calculation)
 */
export const BREED_CALORIE_ADJUSTMENTS: Record<string, number> = {
  // Dogs - small breeds tend to have higher metabolism
  Chihuahua: 1.15,
  'Toy Poodle': 1.15,
  Pomeranian: 1.1,
  // Dogs - large breeds
  'German Shepherd': 0.95,
  Labrador: 0.9,
  'Golden Retriever': 0.9,
  Pitbull: 0.95,
  // Cats
  Siamese: 1.1,
  Maine: 0.85,
  Persian: 0.95,
  // Rabbits
  'Dwarf Rabbit': 1.2,
  'Holland Lop': 1.15,
};

/**
 * Daily nutritional targets (percentages or grams per 1000 kcal)
 */
export interface NutritionalTarget {
  protein: number; // grams
  fat: number; // grams
  fiber: number; // grams
  calcium: number; // grams
  phosphorus: number; // grams
  moisture?: number; // percentage
}

/**
 * Breed/species-specific nutritional recommendations
 */
export const BREED_NUTRITIONAL_TARGETS: Record<string, NutritionalTarget> = {
  'dog.default': {
    protein: 18,
    fat: 5,
    fiber: 3,
    calcium: 1.0,
    phosphorus: 0.8,
    moisture: 10,
  },
  'dog.large': {
    protein: 18,
    fat: 5,
    fiber: 4,
    calcium: 1.2,
    phosphorus: 1.0,
    moisture: 10,
  },
  'cat.default': {
    protein: 26,
    fat: 9,
    fiber: 2,
    calcium: 0.8,
    phosphorus: 0.6,
    moisture: 10,
  },
  'rabbit.default': {
    protein: 12,
    fat: 3,
    fiber: 18,
    calcium: 0.8,
    phosphorus: 0.4,
    moisture: 10,
  },
};

/**
 * Represents a single meal log entry
 */
export interface MealLog {
  id: string;
  petId: string;
  date: string; // ISO date string
  time: string; // HH:mm format
  foodName: string;
  quantity: number; // grams
  calories: number;
  protein: number; // grams
  fat: number; // grams
  fiber: number; // grams
  calcium: number; // grams
  phosphorus: number; // grams
  notes?: string;
  createdAt: string;
  updatedAt: string;
  synced?: boolean;
}

/**
 * Nutritional gap analysis result
 */
export interface NutritionalGap {
  nutrient: string;
  target: number;
  actual: number;
  gap: number; // negative = deficiency, positive = excess
  status: 'deficient' | 'adequate' | 'excess';
}

/**
 * Breed nutritional recommendations result
 */
export interface BreedRecommendation {
  breedId: string;
  breedName: string;
  species: Species;
  recommendedDailyCalories: number;
  nutritionalTargets: NutritionalTarget;
  notes?: string;
}

/**
 * Typed error for breed not found
 */
export class BreedNotFoundError extends Error {
  constructor(breedId: string) {
    super(`Breed with ID "${breedId}" not found`);
    this.name = 'BreedNotFoundError';
  }
}
