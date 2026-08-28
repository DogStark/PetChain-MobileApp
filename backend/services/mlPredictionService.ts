import { randomUUID } from 'crypto';

export type VitalType = 'weight' | 'temperature' | 'heart_rate' | 'activity_level';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface VitalReading {
  petId: string;
  vitalType: VitalType;
  value: number;
  unit?: string;
  recordedAt: string;
}

export interface PetPredictionInput {
  petId: string;
  ownerId: string;
  species?: string;
  vitals: VitalReading[];
}

export interface HealthPrediction {
  petId: string;
  ownerId: string;
  predictedIssue: string;
  riskScore: number;
  riskLevel: RiskLevel;
  contributingFactors: string[];
  modelVersion: string;
  generatedAt: string;
}

export interface GeneratedHealthAlert {
  id: string;
  petId: string;
  ownerId: string;
  predictedIssue: string;
  riskScore: number;
  riskLevel: 'medium' | 'high';
  contributingFactors: string[];
  modelVersion: string;
  status: 'active';
  createdAt: string;
}

type FeatureVector = [number, number, number, number, number];

interface TrainingSample {
  features: FeatureVector;
  label: 0 | 1;
}

const MODEL_VERSION = 'petchain-logreg-v1';
const ALERT_THRESHOLD = 0.65;
const MEDIUM_THRESHOLD = 0.42;

// Anonymized pet-vitals feature rows. Features are:
// weightGainPct, temperatureRisk, lowActivityRatio, heartRateRisk, sparseDataPenalty.
const ANONYMIZED_TRAINING_DATA: TrainingSample[] = [
  { features: [0.02, 0.05, 0.1, 0.05, 0], label: 0 },
  { features: [0.04, 0.1, 0.2, 0.05, 0], label: 0 },
  { features: [0.08, 0.15, 0.25, 0.1, 0], label: 0 },
  { features: [0.16, 0.25, 0.55, 0.25, 0], label: 1 },
  { features: [0.2, 0.4, 0.65, 0.35, 0], label: 1 },
  { features: [0.12, 0.65, 0.5, 0.45, 0], label: 1 },
  { features: [0.01, 0.8, 0.3, 0.2, 0], label: 1 },
  { features: [0.03, 0.15, 0.7, 0.15, 0], label: 1 },
  { features: [0.0, 0.05, 0.05, 0.05, 0.3], label: 0 },
  { features: [0.11, 0.2, 0.35, 0.15, 0.1], label: 0 },
];

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function trainLogisticRegression(samples: TrainingSample[]) {
  const weights = new Array(samples[0].features.length).fill(0);
  let bias = -1.2;
  const learningRate = 0.55;

  for (let epoch = 0; epoch < 700; epoch += 1) {
    for (const sample of samples) {
      const z =
        bias + sample.features.reduce((sum, feature, index) => sum + feature * weights[index], 0);
      const error = sigmoid(z) - sample.label;
      for (let i = 0; i < weights.length; i += 1) {
        weights[i] -= learningRate * error * sample.features[i];
      }
      bias -= learningRate * error;
    }
  }

  return { weights, bias };
}

const MODEL = trainLogisticRegression(ANONYMIZED_TRAINING_DATA);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sortByDate(readings: VitalReading[]): VitalReading[] {
  return [...readings].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
}

function recent(readings: VitalReading[], days: number): VitalReading[] {
  if (!readings.length) return [];
  const latest = Math.max(...readings.map((reading) => new Date(reading.recordedAt).getTime()));
  const cutoff = latest - days * 24 * 60 * 60 * 1000;
  return readings.filter((reading) => new Date(reading.recordedAt).getTime() >= cutoff);
}

function buildFeatures(vitals: VitalReading[]): { features: FeatureVector; factors: string[] } {
  const byType = {
    weight: sortByDate(vitals.filter((reading) => reading.vitalType === 'weight')),
    temperature: sortByDate(vitals.filter((reading) => reading.vitalType === 'temperature')),
    heart_rate: sortByDate(vitals.filter((reading) => reading.vitalType === 'heart_rate')),
    activity_level: sortByDate(vitals.filter((reading) => reading.vitalType === 'activity_level')),
  };

  const factors: string[] = [];
  const firstWeight = byType.weight[0]?.value;
  const latestWeight = byType.weight[byType.weight.length - 1]?.value;
  const weightGainPct =
    firstWeight && latestWeight ? clamp((latestWeight - firstWeight) / firstWeight, 0, 0.4) : 0;
  if (weightGainPct >= 0.1) factors.push('weight gain');

  const latestTemp = byType.temperature[byType.temperature.length - 1]?.value;
  const temperatureRisk = latestTemp ? clamp(Math.abs(latestTemp - 38.6) / 2.2, 0, 1) : 0.15;
  if (latestTemp && (latestTemp > 39.4 || latestTemp < 37.8)) factors.push('abnormal temperature');

  const recentActivity = recent(byType.activity_level, 14);
  const lowActivityRatio = recentActivity.length
    ? recentActivity.filter((reading) => reading.value <= 1).length / recentActivity.length
    : 0.2;
  if (lowActivityRatio >= 0.5) factors.push('reduced activity');

  const latestHeartRate = byType.heart_rate[byType.heart_rate.length - 1]?.value;
  const heartRateRisk = latestHeartRate
    ? latestHeartRate < 60
      ? clamp((60 - latestHeartRate) / 40, 0, 1)
      : clamp((latestHeartRate - 140) / 80, 0, 1)
    : 0.1;
  if (latestHeartRate && (latestHeartRate < 60 || latestHeartRate > 140)) {
    factors.push('heart rate outside baseline');
  }

  const sparseDataPenalty = vitals.length < 4 ? 0.3 : 0;
  if (sparseDataPenalty) factors.push('limited recent vitals');

  return {
    features: [weightGainPct, temperatureRisk, lowActivityRatio, heartRateRisk, sparseDataPenalty],
    factors,
  };
}

export function predictPetHealth(input: PetPredictionInput): HealthPrediction {
  const { features, factors } = buildFeatures(input.vitals);
  const z =
    MODEL.bias + features.reduce((sum, feature, index) => sum + feature * MODEL.weights[index], 0);
  const riskScore = Number(sigmoid(z).toFixed(3));
  const riskLevel: RiskLevel =
    riskScore >= ALERT_THRESHOLD ? 'high' : riskScore >= MEDIUM_THRESHOLD ? 'medium' : 'low';

  return {
    petId: input.petId,
    ownerId: input.ownerId,
    predictedIssue:
      riskScore >= 0.72 ? 'possible acute health deterioration' : 'possible emerging health issue',
    riskScore,
    riskLevel,
    contributingFactors: factors.length ? factors : ['stable vitals baseline'],
    modelVersion: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
  };
}

export function runDailyPredictions(inputs: PetPredictionInput[]): GeneratedHealthAlert[] {
  return inputs
    .map(predictPetHealth)
    .filter((prediction) => prediction.riskLevel === 'high')
    .map((prediction) => ({
      id: randomUUID(),
      petId: prediction.petId,
      ownerId: prediction.ownerId,
      predictedIssue: prediction.predictedIssue,
      riskScore: prediction.riskScore,
      riskLevel: prediction.riskLevel as 'high',
      contributingFactors: prediction.contributingFactors,
      modelVersion: prediction.modelVersion,
      status: 'active',
      createdAt: prediction.generatedAt,
    }));
}

export default {
  predictPetHealth,
  runDailyPredictions,
};
