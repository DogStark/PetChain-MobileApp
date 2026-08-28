import healthScoringServiceV2 from '../services/healthScoringServiceV2';
import { query } from '../src/db';

jest.mock('../src/db');

describe('HealthScoringServiceV2', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('calculateHealthScore', () => {
    it('should calculate health score with all factors', async () => {
      const mockPet = {
        id: 'pet_1',
        species: 'Canine',
        breed: 'Labrador',
        date_of_birth: new Date(new Date().getFullYear() - 5, 0, 1),
        weight: 30,
        ideal_weight: 30,
      };

      const mockMetrics = [
        {
          id: 'metric_1',
          data: {
            vaccinations_up_to_date: true,
            weight: 30,
            activity_level: 'high',
            diet_quality: 'excellent',
            dental_health: 'healthy',
            mental_wellbeing: 'excellent',
          },
        },
      ];

      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockPet] })
        .mockResolvedValueOnce({ rows: [{ weights: '{}', dataPoints: 0 }] })
        .mockResolvedValueOnce({ rows: mockMetrics })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await healthScoringServiceV2.calculateHealthScore('pet_1');

      expect(result.overallScore).toBeGreaterThan(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
      expect(result.confidenceInterval).toHaveProperty('min');
      expect(result.confidenceInterval).toHaveProperty('max');
      expect(result.factors).toHaveLength(9);
      expect(result.topStrengths).toHaveLength(3);
      expect(result.areasForImprovement).toHaveLength(3);
    });

    it('should calculate high score for healthy pet', async () => {
      const mockPet = {
        id: 'pet_1',
        species: 'Canine',
        breed: 'Labrador',
        date_of_birth: new Date(new Date().getFullYear() - 5, 0, 1),
        weight: 30,
        ideal_weight: 30,
      };

      const mockMetrics = [
        {
          id: 'metric_1',
          created_at: new Date(),
          data: {
            vaccinations_up_to_date: true,
            weight: 30,
            activity_level: 'high',
            diet_quality: 'excellent',
            dental_health: 'healthy',
            mental_wellbeing: 'excellent',
          },
        },
      ];

      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockPet] })
        .mockResolvedValueOnce({ rows: [{ weights: '{}', dataPoints: 0 }] })
        .mockResolvedValueOnce({ rows: mockMetrics })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await healthScoringServiceV2.calculateHealthScore('pet_1');

      expect(result.overallScore).toBeGreaterThan(70);
    });

    it('should calculate lower score for pet with health issues', async () => {
      const mockPet = {
        id: 'pet_1',
        species: 'Canine',
        breed: 'Labrador',
        date_of_birth: new Date(new Date().getFullYear() - 15, 0, 1), // Old dog
        weight: 40,
        ideal_weight: 30,
      };

      const mockMetrics = [
        {
          id: 'metric_1',
          created_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          data: {
            vaccinations_up_to_date: false,
            weight: 40,
            activity_level: 'low',
            diet_quality: 'poor',
            dental_health: 'disease',
            mental_wellbeing: 'stressed',
            chronic_conditions: true,
          },
        },
      ];

      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockPet] })
        .mockResolvedValueOnce({ rows: [{ weights: '{}', dataPoints: 0 }] })
        .mockResolvedValueOnce({ rows: mockMetrics })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await healthScoringServiceV2.calculateHealthScore('pet_1');

      expect(result.overallScore).toBeLessThan(60);
    });
  });

  describe('analyzeSpeciesData', () => {
    it('should analyze species data and return weights', async () => {
      (query as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            avg_age: 5,
            avg_vaccination: 90,
            pet_count: 100,
          },
        ],
      });

      (query as jest.Mock).mockResolvedValueOnce({
        rows: [{ id: 'weights_1' }],
      });

      const weights = await healthScoringServiceV2.analyzeSpeciesData('Canine', 'Labrador');

      expect(weights.species).toBe('Canine');
      expect(weights.breed).toBe('Labrador');
      expect(weights.weights).toBeDefined();
      expect(weights.dataPoints).toBeGreaterThanOrEqual(0);
    });

    it('should return default weights if no species data found', async () => {
      (query as jest.Mock).mockResolvedValueOnce({
        rows: [],
      });

      const weights = await healthScoringServiceV2.analyzeSpeciesData('UnknownSpecies');

      expect(weights.weights.vaccination).toBeGreaterThan(0);
      expect(weights.dataPoints).toBe(0);
    });
  });

  describe('updateHealthScoreIncremental', () => {
    it('should update health score incrementally', async () => {
      const mockCurrentMetric = {
        id: 'metric_1',
        data: {
          weight: 30,
          activity_level: 'moderate',
        },
      };

      const mockPet = {
        id: 'pet_1',
        species: 'Canine',
        breed: 'Labrador',
        date_of_birth: new Date(new Date().getFullYear() - 5, 0, 1),
        weight: 30,
        ideal_weight: 30,
      };

      // Mock queries for update and recalculation
      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockCurrentMetric] })
        .mockResolvedValueOnce({ rows: [{ id: 'metric_1' }] })
        .mockResolvedValueOnce({ rows: [mockPet] })
        .mockResolvedValueOnce({ rows: [{ weights: '{}', dataPoints: 0 }] })
        .mockResolvedValueOnce({ rows: [{ ...mockCurrentMetric, activity_level: 'high' }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await healthScoringServiceV2.updateHealthScoreIncremental('pet_1', {
        activityLevel: 95,
      });

      expect(result.overallScore).toBeDefined();
      expect(result.overallScore).toBeGreaterThan(0);
    });
  });

  describe('compareAlgorithms', () => {
    it('should compare v1 and v2 algorithm scores', async () => {
      const mockPet = {
        id: 'pet_1',
        health_score: 75,
        species: 'Canine',
        breed: 'Labrador',
        date_of_birth: new Date(new Date().getFullYear() - 5, 0, 1),
        weight: 30,
        ideal_weight: 30,
      };

      const mockMetrics = [
        {
          id: 'metric_1',
          data: {
            vaccinations_up_to_date: true,
            weight: 30,
            activity_level: 'high',
          },
        },
      ];

      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockPet] })
        .mockResolvedValueOnce({ rows: [mockPet] })
        .mockResolvedValueOnce({ rows: [{ weights: '{}', dataPoints: 0 }] })
        .mockResolvedValueOnce({ rows: mockMetrics })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const comparison = await healthScoringServiceV2.compareAlgorithms('pet_1');

      expect(comparison.v1Score).toBe(75);
      expect(comparison.v2Score).toBeDefined();
      expect(comparison.difference).toBeDefined();
      expect(comparison.percentageDifference).toBeDefined();
      expect(comparison.v2Explanation).toBeDefined();
    });
  });

  describe('confidenceInterval', () => {
    it('should narrow confidence interval with more data', async () => {
      const mockPet = {
        id: 'pet_1',
        species: 'Canine',
        date_of_birth: new Date(new Date().getFullYear() - 5, 0, 1),
        weight: 30,
        ideal_weight: 30,
      };

      const mockMetrics = Array(25)
        .fill(null)
        .map((_, i) => ({
          id: `metric_${i}`,
          created_at: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
          data: { activity_level: 'high' },
        }));

      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockPet] })
        .mockResolvedValueOnce({ rows: [{ weights: '{}', dataPoints: 0 }] })
        .mockResolvedValueOnce({ rows: mockMetrics })
        .mockResolvedValueOnce({ rows: [{ count: 25 }] });

      const result = await healthScoringServiceV2.calculateHealthScore('pet_1');

      // With 25 data points, confidence interval should be ±5
      expect(result.confidenceInterval.max - result.confidenceInterval.min).toBeLessThanOrEqual(10);
    });
  });

  describe('factorCalculations', () => {
    it('should calculate age score correctly for young dog', async () => {
      const mockPet = {
        id: 'pet_1',
        species: 'Canine',
        date_of_birth: new Date(new Date().getFullYear() - 1, 0, 1),
        weight: 30,
        ideal_weight: 30,
      };

      const mockMetrics = [
        {
          id: 'metric_1',
          data: { activity_level: 'high' },
        },
      ];

      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockPet] })
        .mockResolvedValueOnce({ rows: [{ weights: '{}', dataPoints: 0 }] })
        .mockResolvedValueOnce({ rows: mockMetrics })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await healthScoringServiceV2.calculateHealthScore('pet_1');

      const ageFactor = result.factors.find((f) => f.name.toLowerCase().includes('age'));
      expect(ageFactor?.score).toBeGreaterThan(70);
    });

    it('should calculate weight score based on ideal weight', async () => {
      const mockPet = {
        id: 'pet_1',
        species: 'Canine',
        date_of_birth: new Date(new Date().getFullYear() - 5, 0, 1),
        weight: 30,
        ideal_weight: 30,
      };

      const mockMetrics = [
        {
          id: 'metric_1',
          data: { weight: 35 }, // 5 pounds over, ~17% difference
        },
      ];

      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockPet] })
        .mockResolvedValueOnce({ rows: [{ weights: '{}', dataPoints: 0 }] })
        .mockResolvedValueOnce({ rows: mockMetrics })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const result = await healthScoringServiceV2.calculateHealthScore('pet_1');

      const weightFactor = result.factors.find((f) => f.name.toLowerCase().includes('weight'));
      expect(weightFactor?.score).toBeLessThan(95); // Should be slightly lower than perfect
      expect(weightFactor?.score).toBeGreaterThan(50); // But still decent
    });
  });
});
