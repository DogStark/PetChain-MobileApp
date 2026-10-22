/**
 * Backend nutrition log models.
 * Mirrors the frontend model with enums for type safety.
 */

export enum MealType {
  BREAKFAST = 'breakfast',
  LUNCH = 'lunch',
  DINNER = 'dinner',
  SNACK = 'snack',
}

export enum FoodUnit {
  GRAMS = 'g',
  KILOGRAMS = 'kg',
  OUNCES = 'oz',
  CUP = 'cup',
  MILLILITERS = 'ml',
}

export enum ActivityLevel {
  LOW = 'low',
  MODERATE = 'moderate',
  HIGH = 'high',
}

/**
 * Core nutrition log entry stored per feeding.
 */
export interface NutritionLog {
  id: string;
  petId: string;
  date: string; // YYYY-MM-DD
  mealType: MealType;
  foodName: string;
  brand?: string;
  amount: number;
  unit: FoodUnit;
  calories: number; // kcal
  protein?: number; // grams
  fat?: number; // grams
  carbs?: number; // grams
  fiber?: number; // grams
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload to create a new nutrition log entry.
 */
export interface CreateNutritionLogInput {
  petId: string;
  date: string;
  mealType: MealType;
  foodName: string;
  brand?: string;
  amount: number;
  unit: FoodUnit;
  calories: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  fiber?: number;
  notes?: string;
}

/**
 * Payload to update an existing nutrition log entry.
 */
export type UpdateNutritionLogInput = Partial<
  Omit<NutritionLog, 'id' | 'petId' | 'createdAt' | 'updatedAt'>
>;

/**
 * Nutrition goal for a pet.
 */
export interface NutritionGoal {
  id: string;
  petId: string;
  dailyCalories: number;
  dailyProteinG?: number;
  dailyFatG?: number;
  dailyCarbsG?: number;
  weightKg?: number;
  activityLevel: ActivityLevel;
  healthConditions: string[];
  notes?: string;
  updatedAt: string;
}

export interface CreateNutritionGoalInput {
  petId: string;
  dailyCalories: number;
  dailyProteinG?: number;
  dailyFatG?: number;
  dailyCarbsG?: number;
  weightKg?: number;
  activityLevel: ActivityLevel;
  healthConditions?: string[];
  notes?: string;
}

export type UpdateNutritionGoalInput = Partial<Omit<NutritionGoal, 'id' | 'petId' | 'updatedAt'>>;
