/**
 * Backend nutrition service.
 * Handles CRUD for nutrition logs and goals, calorie calculations,
 * dietary recommendations, and weekly report generation.
 */

import axios from 'axios';

import {
  ActivityLevel,
  FoodUnit,
  MealType,
  type CreateNutritionGoalInput,
  type CreateNutritionLogInput,
  type NutritionGoal,
  type NutritionLog,
  type UpdateNutritionGoalInput,
  type UpdateNutritionLogInput,
} from '../models/NutritionLog';

const API_URL = process.env.API_URL || 'http://localhost:3000/api';

// ─── Nutrition Logs ───────────────────────────────────────────────────────────

export const getNutritionLogs = async (petId: string): Promise<NutritionLog[]> => {
  const { data } = await axios.get(`${API_URL}/nutrition/logs`, { params: { petId } });
  return data;
};

export const getNutritionLogsByDate = async (
  petId: string,
  date: string,
): Promise<NutritionLog[]> => {
  const { data } = await axios.get(`${API_URL}/nutrition/logs`, { params: { petId, date } });
  return data;
};

export const createNutritionLog = async (input: CreateNutritionLogInput): Promise<NutritionLog> => {
  const { data } = await axios.post(`${API_URL}/nutrition/logs`, input);
  return data;
};

export const updateNutritionLog = async (
  id: string,
  input: UpdateNutritionLogInput,
): Promise<NutritionLog> => {
  const { data } = await axios.put(`${API_URL}/nutrition/logs/${id}`, input);
  return data;
};

export const deleteNutritionLog = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/nutrition/logs/${id}`);
};

// ─── Nutrition Goals ──────────────────────────────────────────────────────────

export const getNutritionGoal = async (petId: string): Promise<NutritionGoal | null> => {
  try {
    const { data } = await axios.get(`${API_URL}/nutrition/goals/${petId}`);
    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
};

export const createNutritionGoal = async (
  input: CreateNutritionGoalInput,
): Promise<NutritionGoal> => {
  const { data } = await axios.post(`${API_URL}/nutrition/goals`, input);
  return data;
};

export const updateNutritionGoal = async (
  petId: string,
  input: UpdateNutritionGoalInput,
): Promise<NutritionGoal> => {
  const { data } = await axios.put(`${API_URL}/nutrition/goals/${petId}`, input);
  return data;
};

// ─── Calorie Calculations ─────────────────────────────────────────────────────

/**
 * Calculate recommended daily calories using the RER formula.
 * RER = 70 × (weight_kg ^ 0.75), then multiplied by activity factor.
 */
export const calculateRecommendedCalories = (
  weightKg: number,
  species: string,
  activityLevel: ActivityLevel,
  healthConditions: string[] = [],
): number => {
  if (weightKg <= 0) return 0;

  const rer = 70 * Math.pow(weightKg, 0.75);

  const activityMultipliers: Record<ActivityLevel, number> = {
    [ActivityLevel.LOW]: 1.2,
    [ActivityLevel.MODERATE]: 1.6,
    [ActivityLevel.HIGH]: 2.0,
  };
  let multiplier = activityMultipliers[activityLevel] ?? 1.6;

  if (species === 'cat') multiplier *= 0.9;
  if (healthConditions.includes('obesity')) multiplier *= 0.8;
  if (healthConditions.includes('diabetes')) multiplier *= 0.85;
  if (healthConditions.includes('kidney_disease')) multiplier *= 0.9;
  if (healthConditions.includes('hyperthyroidism')) multiplier *= 1.1;

  return Math.round(rer * multiplier);
};

/**
 * Determine feeding status relative to daily goal.
 */
export const getFeedingStatus = (
  totalCalories: number,
  goalCalories: number,
): 'under' | 'on_track' | 'over' => {
  if (goalCalories <= 0) return 'on_track';
  const ratio = totalCalories / goalCalories;
  if (ratio < 0.9) return 'under';
  if (ratio > 1.1) return 'over';
  return 'on_track';
};

/**
 * Get dietary recommendations based on species, breed, and health conditions.
 */
export const getDietaryRecommendations = (
  species: string,
  breed: string,
  healthConditions: string[],
): string[] => {
  const tips: string[] = [];

  if (species === 'dog') {
    tips.push('Dogs need a balanced diet with protein, fats, and carbohydrates.');
    if (breed.toLowerCase().includes('labrador') || breed.toLowerCase().includes('retriever')) {
      tips.push('Labradors are prone to obesity — monitor calorie intake carefully.');
    }
    if (breed.toLowerCase().includes('bulldog')) {
      tips.push('Bulldogs can have sensitive stomachs — avoid sudden diet changes.');
    }
  } else if (species === 'cat') {
    tips.push('Cats are obligate carnivores — ensure high protein content in their diet.');
    tips.push('Cats need taurine from animal sources for heart and eye health.');
  }

  if (healthConditions.includes('obesity')) {
    tips.push('Reduce calorie intake by 20% and increase exercise. Use weight-management food.');
  }
  if (healthConditions.includes('diabetes')) {
    tips.push(
      'Feed consistent portions at regular times. Low-glycemic, high-fiber diets help regulate blood sugar.',
    );
  }
  if (healthConditions.includes('kidney_disease')) {
    tips.push('Low-phosphorus, low-protein diets are recommended. Consult your vet.');
  }
  if (healthConditions.includes('allergies')) {
    tips.push('Consider a limited-ingredient or hydrolyzed protein diet.');
  }
  if (healthConditions.includes('heart_disease')) {
    tips.push('Low-sodium diets are important for pets with heart conditions.');
  }

  if (tips.length === 0) {
    tips.push("Maintain a balanced diet appropriate for your pet's age and size.");
  }

  return tips;
};

// ─── Weekly Report ────────────────────────────────────────────────────────────

export interface DailySummary {
  date: string;
  totalCalories: number;
  totalProteinG: number;
  totalFatG: number;
  totalCarbsG: number;
  mealCount: number;
  status: 'under' | 'on_track' | 'over';
}

export interface WeeklyReport {
  petId: string;
  weekStart: string;
  weekEnd: string;
  dailySummaries: DailySummary[];
  avgDailyCalories: number;
  avgDailyProteinG: number;
  avgDailyFatG: number;
  avgDailyCarbsG: number;
  daysOnTrack: number;
  daysUnder: number;
  daysOver: number;
  recommendation: string;
}

export const generateWeeklyReport = async (
  petId: string,
  weekStart: string,
): Promise<WeeklyReport> => {
  const { data } = await axios.get(`${API_URL}/nutrition/reports/weekly`, {
    params: { petId, weekStart },
  });
  return data;
};

// ─── Mock Food Database ───────────────────────────────────────────────────────

export interface FoodDatabaseItem {
  id: string;
  name: string;
  brand?: string;
  category: string;
  caloriesPer100g: number;
  proteinPer100g?: number;
  fatPer100g?: number;
  carbsPer100g?: number;
  suitableFor: string[];
}

export const searchFoodDatabase = async (query: string): Promise<FoodDatabaseItem[]> => {
  const { data } = await axios.get(`${API_URL}/nutrition/foods/search`, {
    params: { q: query },
  });
  return data;
};

export { MealType, FoodUnit, ActivityLevel };
