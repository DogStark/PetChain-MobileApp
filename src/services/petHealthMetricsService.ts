/**
 * Tracks and calculates pet health metrics: weight trends, a BMI-equivalent
 * body condition score, and an overall health score.
 */

export interface WeightEntry {
  date: Date;
  weightKg: number;
}

export type WeightTrendDirection = 'gaining' | 'losing' | 'stable';

export interface WeightTrend {
  direction: WeightTrendDirection;
  /** Change in weight (kg) from the first to the last entry. */
  changeKg: number;
  /** Percentage change relative to the first entry. */
  percentChange: number;
}

/**
 * Analyzes a chronologically ordered series of weight entries and returns
 * the overall trend direction and magnitude of change.
 */
export function calculateWeightTrend(entries: WeightEntry[]): WeightTrend {
  if (entries.length < 2) {
    return { direction: 'stable', changeKg: 0, percentChange: 0 };
  }

  const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = sorted[0].weightKg;
  const last = sorted[sorted.length - 1].weightKg;
  const changeKg = last - first;
  const percentChange = first === 0 ? 0 : (changeKg / first) * 100;

  const STABLE_THRESHOLD_PERCENT = 2;
  let direction: WeightTrendDirection = 'stable';
  if (percentChange > STABLE_THRESHOLD_PERCENT) direction = 'gaining';
  else if (percentChange < -STABLE_THRESHOLD_PERCENT) direction = 'losing';

  return { direction, changeKg, percentChange };
}

/**
 * Calculates a BMI-equivalent body condition index for a pet, using the
 * common weight-to-height-squared ratio (kg/m^2), analogous to human BMI.
 */
export function calculateBodyConditionIndex(weightKg: number, heightM: number): number {
  if (heightM <= 0) return 0;
  return Number((weightKg / (heightM * heightM)).toFixed(2));
}

export interface HealthMetricsSummary {
  weightTrend: WeightTrend;
  bodyConditionIndex: number;
  /** Overall health score from 0 (poor) to 100 (excellent). */
  healthScore: number;
}

export interface HealthMetricsInput {
  weightHistory: WeightEntry[];
  heightM: number;
  /** Number of missed vet-recommended checkups in the last 12 months. */
  missedCheckups?: number;
  /** Number of active/chronic conditions currently being managed. */
  activeConditions?: number;
}

/**
 * Combines weight trend, body condition, and general wellness factors into
 * a single overall health score for a pet.
 */
export function calculateHealthScore(input: HealthMetricsInput): HealthMetricsSummary {
  const { weightHistory, heightM, missedCheckups = 0, activeConditions = 0 } = input;

  const weightTrend = calculateWeightTrend(weightHistory);
  const lastWeight = weightHistory.length
    ? weightHistory[weightHistory.length - 1].weightKg
    : 0;
  const bodyConditionIndex = calculateBodyConditionIndex(lastWeight, heightM);

  let score = 100;

  // Penalize significant, potentially concerning weight change.
  if (weightTrend.direction !== 'stable') {
    score -= Math.min(30, Math.abs(weightTrend.percentChange) * 2);
  }

  // Body condition index outside a healthy reference range (roughly 18-30
  // for common companion animals) reduces the score.
  if (bodyConditionIndex > 0 && (bodyConditionIndex < 18 || bodyConditionIndex > 30)) {
    score -= 15;
  }

  score -= Math.min(30, missedCheckups * 5);
  score -= Math.min(30, activeConditions * 10);

  return {
    weightTrend,
    bodyConditionIndex,
    healthScore: Math.max(0, Math.round(score)),
  };
}
