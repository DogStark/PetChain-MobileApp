export type ActivityLevel = 'low' | 'moderate' | 'high';

export interface HealthMetricEntry {
  id: string;
  petId: string;
  recordedAt: string;
  weightKg?: number;
  temperatureC?: number;
  activityLevel?: ActivityLevel;
  notes?: string;
}
