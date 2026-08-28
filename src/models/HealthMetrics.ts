export enum HealthTrend {
  IMPROVING = 'IMPROVING',
  STABLE = 'STABLE',
  DECLINING = 'DECLINING',
}

export type WeightRecord = {
  id: string;
  petId: string;
  weight: number;
  date: string;
};

export type HealthScore = {
  score: number;
  trend: HealthTrend;
  evaluatedAt: string;
};

export interface HealthMetrics {
  petId: string;
  weight: number;
  height: number;
  bcs: number;
  date: string;
}
