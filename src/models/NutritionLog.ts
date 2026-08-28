/**
 * Nutrition log model for mobile app.
 * Tracks individual feedings, daily calorie intake, and dietary goals per pet.
 */

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type FoodUnit = 'g' | 'kg' | 'oz' | 'cup' | 'ml';

/**
 * A single feeding entry logged by the owner.
 */
export interface NutritionLog {
  id: string;
  petId: string;
  date: string; // ISO date string (YYYY-MM-DD)
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
  createdAt: string; // ISO datetime
  updatedAt?: string;
}

/**
 * Daily nutrition goal for a pet, derived from breed/weight/health conditions.
 */
export interface NutritionGoal {
  id: string;
  petId: string;
  dailyCalories: number; // kcal/day recommended
  dailyProteinG?: number;
  dailyFatG?: number;
  dailyCarbsG?: number;
  weightKg?: number;
  activityLevel: 'low' | 'moderate' | 'high';
  healthConditions: string[]; // e.g. ['diabetes', 'obesity']
  notes?: string;
  updatedAt: string;
}

/**
 * Summary of a single day's nutrition for a pet.
 */
export interface DailyNutritionSummary {
  date: string;
  petId: string;
  totalCalories: number;
  totalProteinG: number;
  totalFatG: number;
  totalCarbsG: number;
  mealCount: number;
  logs: NutritionLog[];
  goal?: NutritionGoal;
  status: 'under' | 'on_track' | 'over';
}

/**
 * Weekly nutrition report for a pet.
 */
export interface WeeklyNutritionReport {
  petId: string;
  weekStart: string; // ISO date (Monday)
  weekEnd: string; // ISO date (Sunday)
  dailySummaries: DailyNutritionSummary[];
  avgDailyCalories: number;
  avgDailyProteinG: number;
  avgDailyFatG: number;
  avgDailyCarbsG: number;
  daysOnTrack: number;
  daysUnder: number;
  daysOver: number;
  recommendation: string;
}

/**
 * A food item from the nutrition database (mock API).
 */
export interface FoodItem {
  id: string;
  name: string;
  brand?: string;
  category: 'dry' | 'wet' | 'raw' | 'treat' | 'supplement' | 'homemade';
  caloriesPer100g: number;
  proteinPer100g?: number;
  fatPer100g?: number;
  carbsPer100g?: number;
  fiberPer100g?: number;
  suitableFor: string[]; // species: ['dog', 'cat']
}

export interface NutritionLogFormData {
  petId: string;
  date: string;
  mealType: MealType;
  foodName: string;
  brand: string;
  amount: string; // string for TextInput
  unit: FoodUnit;
  calories: string; // string for TextInput
  protein: string;
  fat: string;
  carbs: string;
  notes: string;
}

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const FOOD_UNITS: FoodUnit[] = ['g', 'kg', 'oz', 'cup', 'ml'];

export const EMPTY_LOG_FORM: NutritionLogFormData = {
  petId: '',
  date: new Date().toISOString().slice(0, 10),
  mealType: 'breakfast',
  foodName: '',
  brand: '',
  amount: '',
  unit: 'g',
  calories: '',
  protein: '',
  fat: '',
  carbs: '',
  notes: '',
};
