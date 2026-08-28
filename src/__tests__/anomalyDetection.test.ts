import { checkAnomaly, detectAnomalies, getThreshold } from '../../utils/anomalyDetection';

describe('anomalyDetection', () => {
  describe('getThreshold', () => {
    it('returns species temperature range for dog', () => {
      const range = getThreshold('temperature', 'dog');
      expect(range).toEqual({ min: 37.8, max: 39.2 });
    });

    it('returns species heart_rate range for cat', () => {
      const range = getThreshold('heart_rate', 'cat');
      expect(range).toEqual({ min: 120, max: 220 });
    });

    it('returns breed weight range when breed matches', () => {
      const range = getThreshold('weight', 'dog', 'Labrador Retriever');
      expect(range).toEqual({ min: 25, max: 36 });
    });

    it('is case-insensitive for species and breed', () => {
      const range = getThreshold('weight', 'DOG', 'CHIHUAHUA');
      expect(range).toEqual({ min: 1.5, max: 3.0 });
    });

    it('returns null for unknown species', () => {
      expect(getThreshold('temperature', 'dragon')).toBeNull();
    });

    it('returns null for weight with no breed and no species default', () => {
      // dog has no species-level weight default
      expect(getThreshold('weight', 'dog')).toBeNull();
    });

    it('returns null for weight with unknown breed, falls back to species default (null for dog)', () => {
      expect(getThreshold('weight', 'dog', 'unknown breed')).toBeNull();
    });

    it('returns rabbit temperature range', () => {
      const range = getThreshold('temperature', 'rabbit');
      expect(range).toEqual({ min: 38.5, max: 40.0 });
    });

    it('returns bird heart_rate range', () => {
      const range = getThreshold('heart_rate', 'bird');
      expect(range).toEqual({ min: 200, max: 400 });
    });
  });

  describe('checkAnomaly', () => {
    it('returns isAnomaly=false for normal dog temperature', () => {
      const result = checkAnomaly('temperature', 38.5, 'dog');
      expect(result.isAnomaly).toBe(false);
      expect(result.message).toBeUndefined();
    });

    it('detects high dog temperature', () => {
      const result = checkAnomaly('temperature', 40.0, 'dog');
      expect(result.isAnomaly).toBe(true);
      expect(result.message).toMatch(/temperature/);
      expect(result.message).toMatch(/40/);
    });

    it('detects low dog temperature', () => {
      const result = checkAnomaly('temperature', 37.0, 'dog');
      expect(result.isAnomaly).toBe(true);
    });

    it('returns isAnomaly=false for normal cat heart rate', () => {
      const result = checkAnomaly('heart_rate', 160, 'cat');
      expect(result.isAnomaly).toBe(false);
    });

    it('detects high cat heart rate', () => {
      const result = checkAnomaly('heart_rate', 250, 'cat');
      expect(result.isAnomaly).toBe(true);
    });

    it('detects low cat heart rate', () => {
      const result = checkAnomaly('heart_rate', 100, 'cat');
      expect(result.isAnomaly).toBe(true);
    });

    it('detects overweight Labrador', () => {
      const result = checkAnomaly('weight', 40, 'dog', 'Labrador Retriever');
      expect(result.isAnomaly).toBe(true);
      expect(result.range).toEqual({ min: 25, max: 36 });
    });

    it('returns isAnomaly=false for healthy Labrador weight', () => {
      const result = checkAnomaly('weight', 30, 'dog', 'Labrador Retriever');
      expect(result.isAnomaly).toBe(false);
    });

    it('returns isAnomaly=false when no threshold defined (unknown species)', () => {
      const result = checkAnomaly('temperature', 99, 'dragon');
      expect(result.isAnomaly).toBe(false);
    });

    it('includes species and breed in anomaly message', () => {
      const result = checkAnomaly('weight', 50, 'dog', 'Golden Retriever');
      expect(result.isAnomaly).toBe(true);
      expect(result.message).toMatch(/dog/);
      expect(result.message).toMatch(/Golden Retriever/);
    });

    it('boundary: value equal to min is not anomalous', () => {
      const result = checkAnomaly('temperature', 37.8, 'dog');
      expect(result.isAnomaly).toBe(false);
    });

    it('boundary: value equal to max is not anomalous', () => {
      const result = checkAnomaly('temperature', 39.2, 'dog');
      expect(result.isAnomaly).toBe(false);
    });

    it('boundary: value just below min is anomalous', () => {
      const result = checkAnomaly('temperature', 37.79, 'dog');
      expect(result.isAnomaly).toBe(true);
    });

    it('boundary: value just above max is anomalous', () => {
      const result = checkAnomaly('temperature', 39.21, 'dog');
      expect(result.isAnomaly).toBe(true);
    });
  });

  describe('detectAnomalies', () => {
    it('returns empty array when all vitals are normal', () => {
      const results = detectAnomalies(
        [
          { vitalType: 'temperature', value: 38.5 },
          { vitalType: 'heart_rate', value: 100 },
        ],
        'dog',
      );
      expect(results).toHaveLength(0);
    });

    it('returns only anomalous vitals', () => {
      const results = detectAnomalies(
        [
          { vitalType: 'temperature', value: 38.5 }, // normal
          { vitalType: 'heart_rate', value: 200 }, // high for dog
        ],
        'dog',
      );
      expect(results).toHaveLength(1);
      expect(results[0].vitalType).toBe('heart_rate');
    });

    it('returns multiple anomalies when multiple vitals are out of range', () => {
      const results = detectAnomalies(
        [
          { vitalType: 'temperature', value: 41.0 },
          { vitalType: 'heart_rate', value: 200 },
        ],
        'dog',
      );
      expect(results).toHaveLength(2);
    });

    it('passes breed to weight check', () => {
      const results = detectAnomalies([{ vitalType: 'weight', value: 0.5 }], 'dog', 'Chihuahua');
      expect(results).toHaveLength(1);
      expect(results[0].isAnomaly).toBe(true);
    });

    it('handles empty readings array', () => {
      expect(detectAnomalies([], 'cat')).toHaveLength(0);
    });
  });
});
