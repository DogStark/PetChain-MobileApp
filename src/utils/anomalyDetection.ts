/**
 * Anomaly detection for pet vitals.
 *
 * Thresholds are keyed by species (lowercase), with optional breed-level
 * overrides. When no breed match is found the species default is used.
 * All numeric ranges are [min, max] inclusive.
 */

export type VitalType = 'weight' | 'temperature' | 'heart_rate' | 'activity_level';

export interface VitalRange {
  min: number;
  max: number;
}

export interface SpeciesThresholds {
  temperature: VitalRange; // °C
  heart_rate: VitalRange; // bpm
  // weight is breed-specific; omit from species default
  weight?: VitalRange; // kg
  activity_level?: VitalRange; // 1=low, 2=moderate, 3=high
}

export interface AnomalyResult {
  isAnomaly: boolean;
  vitalType: VitalType;
  value: number;
  range: VitalRange;
  message?: string;
}

// ─── Threshold database ───────────────────────────────────────────────────────

const SPECIES_DEFAULTS: Record<string, SpeciesThresholds> = {
  dog: {
    temperature: { min: 37.8, max: 39.2 },
    heart_rate: { min: 60, max: 140 },
    activity_level: { min: 1, max: 3 },
  },
  cat: {
    temperature: { min: 38.1, max: 39.2 },
    heart_rate: { min: 120, max: 220 },
    activity_level: { min: 1, max: 3 },
  },
  rabbit: {
    temperature: { min: 38.5, max: 40.0 },
    heart_rate: { min: 120, max: 150 },
    activity_level: { min: 1, max: 3 },
  },
  bird: {
    temperature: { min: 40.0, max: 42.0 },
    heart_rate: { min: 200, max: 400 },
    activity_level: { min: 1, max: 3 },
  },
};

// Breed-level weight overrides (kg). Keyed as `${species}:${breed}` (lowercase).
const BREED_WEIGHT: Record<string, VitalRange> = {
  // Dogs
  'dog:chihuahua': { min: 1.5, max: 3.0 },
  'dog:labrador retriever': { min: 25, max: 36 },
  'dog:golden retriever': { min: 25, max: 34 },
  'dog:german shepherd': { min: 22, max: 40 },
  'dog:bulldog': { min: 18, max: 25 },
  'dog:poodle': { min: 20, max: 32 },
  'dog:beagle': { min: 9, max: 11 },
  'dog:yorkshire terrier': { min: 1.8, max: 3.2 },
  // Cats
  'cat:maine coon': { min: 4, max: 8 },
  'cat:persian': { min: 3, max: 5.5 },
  'cat:siamese': { min: 3, max: 5 },
  'cat:domestic shorthair': { min: 3.5, max: 5.5 },
  // Rabbits
  'rabbit:holland lop': { min: 0.9, max: 2.0 },
  'rabbit:flemish giant': { min: 6.4, max: 10 },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the threshold range for a given vital type, species, and optional breed.
 * Returns null if no threshold is defined for the combination.
 */
export function getThreshold(
  vitalType: VitalType,
  species: string,
  breed?: string,
): VitalRange | null {
  const speciesKey = species.toLowerCase();
  const defaults = SPECIES_DEFAULTS[speciesKey];

  if (vitalType === 'weight') {
    if (breed) {
      const breedKey = `${speciesKey}:${breed.toLowerCase()}`;
      if (BREED_WEIGHT[breedKey]) return BREED_WEIGHT[breedKey];
    }
    return defaults?.weight ?? null;
  }

  return defaults?.[vitalType] ?? null;
}

/**
 * Checks whether a single vital reading is anomalous.
 */
export function checkAnomaly(
  vitalType: VitalType,
  value: number,
  species: string,
  breed?: string,
): AnomalyResult {
  const range = getThreshold(vitalType, species, breed);

  if (!range) {
    // No threshold defined — cannot determine anomaly
    return { isAnomaly: false, vitalType, value, range: { min: 0, max: Infinity } };
  }

  const isAnomaly = value < range.min || value > range.max;
  const message = isAnomaly
    ? `${vitalType} value ${value} is outside normal range [${range.min}, ${range.max}] for ${species}${breed ? ` (${breed})` : ''}`
    : undefined;

  return { isAnomaly, vitalType, value, range, message };
}

/**
 * Checks multiple vitals at once and returns only the anomalous ones.
 */
export function detectAnomalies(
  readings: { vitalType: VitalType; value: number }[],
  species: string,
  breed?: string,
): AnomalyResult[] {
  return readings
    .map(({ vitalType, value }) => checkAnomaly(vitalType, value, species, breed))
    .filter((r) => r.isAnomaly);
}
