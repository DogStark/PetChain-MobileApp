import { query } from '../src/db';

export interface HealthScoreFactors {
  ageScore: number;
  vacccinationStatus: number;
  medicalHistory: number;
  preventiveCare: number;
  weight: number;
  activityLevel: number;
  dietQuality: number;
  dentalHealth: number;
  mentalWellbeing: number;
}

export interface HealthScoreExplanation {
  overallScore: number;
  confidenceInterval: {
    min: number;
    max: number;
  };
  factors: {
    name: string;
    score: number;
    weight: number;
    contribution: number;
  }[];
  topStrengths: string[];
  areasForImprovement: string[];
  species: string;
  breed?: string;
}

export interface SpeciesWeights {
  species: string;
  breed?: string;
  weights: {
    age: number;
    vaccination: number;
    medicalHistory: number;
    preventiveCare: number;
    weight: number;
    activityLevel: number;
    dietQuality: number;
    dentalHealth: number;
    mentalWellbeing: number;
  };
  dataPoints: number;
  lastUpdated: Date;
}

class HealthScoringServiceV2 {
  private readonly DEFAULT_WEIGHTS = {
    age: 0.15,
    vaccination: 0.2,
    medicalHistory: 0.15,
    preventiveCare: 0.15,
    weight: 0.1,
    activityLevel: 0.1,
    dietQuality: 0.08,
    dentalHealth: 0.05,
    mentalWellbeing: 0.02,
  };

  /**
   * Calculate health score using ML-derived weights
   */
  async calculateHealthScore(petId: string): Promise<HealthScoreExplanation> {
    try {
      // Get pet information
      const petResult = await query('SELECT * FROM pets WHERE id = $1', [petId]);

      if (petResult.rows.length === 0) {
        throw new Error('Pet not found');
      }

      const pet = petResult.rows[0];

      // Get species-specific weights
      const weights = await this.getSpeciesWeights(pet.species, pet.breed);

      // Calculate individual factors
      const factors = await this.calculateHealthFactors(petId, pet);

      // Apply weights to factors
      let weightedScore = 0;
      const weightedFactors = [];

      const factorKeyMap: Record<string, keyof HealthScoreFactors> = {
        age: 'ageScore',
        vaccination: 'vacccinationStatus',
        medicalHistory: 'medicalHistory',
        preventiveCare: 'preventiveCare',
        weight: 'weight',
        activityLevel: 'activityLevel',
        dietQuality: 'dietQuality',
        dentalHealth: 'dentalHealth',
        mentalWellbeing: 'mentalWellbeing',
      };

      for (const [factorName, weight] of Object.entries(weights.weights)) {
        const mappedFactorName =
          factorKeyMap[factorName] || (factorName as keyof HealthScoreFactors);
        const factorScore = factors[mappedFactorName] || 0;
        const contribution = factorScore * weight;
        weightedScore += contribution;

        weightedFactors.push({
          name: this.formatFactorName(factorName),
          score: Math.round(factorScore),
          weight: Math.round(weight * 100),
          contribution: Math.round(contribution),
        });
      }

      // Calculate confidence interval based on data completeness
      const confidenceInterval = await this.calculateConfidenceInterval(petId, weightedScore);

      // Get explanations
      const topStrengths = weightedFactors
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 3)
        .map((f) => f.name);

      const areasForImprovement = weightedFactors
        .sort((a, b) => a.contribution - b.contribution)
        .slice(0, 3)
        .map((f) => f.name);

      return {
        overallScore: Math.round(weightedScore),
        confidenceInterval,
        factors: weightedFactors,
        topStrengths,
        areasForImprovement,
        species: pet.species,
        breed: pet.breed,
      };
    } catch (error) {
      console.error('Error calculating health score:', error);
      throw error;
    }
  }

  /**
   * Analyze historical data to derive feature weights for a species
   */
  async analyzeSpeciesData(species: string, breed?: string): Promise<SpeciesWeights> {
    try {
      // Query historical health data for the species
      const dataQuery = `
        SELECT 
          AVG(CASE WHEN factor_name = 'age' THEN factor_value ELSE 0 END) as avg_age,
          AVG(CASE WHEN factor_name = 'vaccination' THEN factor_value ELSE 0 END) as avg_vaccination,
          COUNT(DISTINCT pet_id) as pet_count
        FROM health_factor_history
        WHERE species = $1 ${breed ? 'AND breed = $2' : ''}
      `;

      const result = await query(dataQuery, breed ? [species, breed] : [species]);

      if (result.rows.length === 0) {
        // Return default weights if no data available
        return {
          species,
          breed,
          weights: this.DEFAULT_WEIGHTS,
          dataPoints: 0,
          lastUpdated: new Date(),
        };
      }

      const data = result.rows[0];

      // Derive weights using simple machine learning approach
      // In production, this would use more sophisticated ML models
      const derivedWeights = await this.deriveWeightsFromData(data, species, breed);

      // Store the derived weights
      const id = `weights_${species}_${breed || 'all'}_${Date.now()}`;
      await query(
        `INSERT INTO species_health_weights (id, species, breed, weights, data_points, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          species,
          breed || null,
          JSON.stringify(derivedWeights),
          data.pet_count || 0,
          new Date(),
        ],
      );

      return {
        species,
        breed,
        weights: derivedWeights,
        dataPoints: data.pet_count || 0,
        lastUpdated: new Date(),
      };
    } catch (error) {
      console.error('Error analyzing species data:', error);
      // Return default weights on error
      return {
        species,
        breed,
        weights: this.DEFAULT_WEIGHTS,
        dataPoints: 0,
        lastUpdated: new Date(),
      };
    }
  }

  async getSpeciesWeights(species: string, breed?: string): Promise<SpeciesWeights> {
    try {
      const result = await query(
        `SELECT weights, data_points, created_at FROM species_health_weights WHERE species = $1 AND (breed = $2 OR breed IS NULL)
         ORDER BY created_at DESC LIMIT 1`,
        [species, breed || null],
      );

      if (result.rows.length === 0) {
        return this.analyzeSpeciesData(species, breed);
      }

      const row = result.rows[0];
      const parsedWeights = row.weights
        ? typeof row.weights === 'string'
          ? JSON.parse(row.weights)
          : row.weights
        : null;

      const validWeights =
        parsedWeights && typeof parsedWeights === 'object' && Object.keys(parsedWeights).length > 0
          ? parsedWeights
          : this.DEFAULT_WEIGHTS;

      return {
        species,
        breed,
        weights: validWeights,
        dataPoints: row.data_points ?? row.dataPoints ?? 0,
        lastUpdated: row.created_at ? new Date(row.created_at) : new Date(),
      };
    } catch (error) {
      console.error('Error loading species weights:', error);
      return {
        species,
        breed,
        weights: this.DEFAULT_WEIGHTS,
        dataPoints: 0,
        lastUpdated: new Date(),
      };
    }
  }

  /**
   * Update health score incrementally as new data arrives
   */
  async updateHealthScoreIncremental(
    petId: string,
    newFactor: Partial<HealthScoreFactors>,
  ): Promise<HealthScoreExplanation> {
    try {
      // Get current health metrics for the pet
      const metricsResult = await query(
        'SELECT * FROM health_metrics WHERE pet_id = $1 ORDER BY created_at DESC LIMIT 1',
        [petId],
      );

      // Update with new factor
      if (metricsResult.rows.length > 0) {
        const currentMetrics = metricsResult.rows[0];
        const updatedMetrics = { ...currentMetrics, ...newFactor };

        await query(`UPDATE health_metrics SET data = $1, updated_at = $2 WHERE id = $3`, [
          JSON.stringify(updatedMetrics),
          new Date(),
          currentMetrics.id,
        ]);
      }

      // Recalculate score
      return this.calculateHealthScore(petId);
    } catch (error) {
      console.error('Error updating health score incrementally:', error);
      throw error;
    }
  }

  /**
   * Compare v1 and v2 algorithm scores for A/B testing
   */
  async compareAlgorithms(petId: string): Promise<{
    v1Score: number;
    v2Score: number;
    v2Explanation: HealthScoreExplanation;
    difference: number;
    percentageDifference: number;
  }> {
    try {
      // Get v1 score (from existing scoring logic)
      const v1Result = await query('SELECT health_score FROM pets WHERE id = $1', [petId]);

      if (v1Result.rows.length === 0) {
        throw new Error('Pet not found');
      }

      const v1Score = v1Result.rows[0].health_score || 0;

      // Get v2 score
      const v2Explanation = await this.calculateHealthScore(petId);

      return {
        v1Score,
        v2Score: v2Explanation.overallScore,
        v2Explanation,
        difference: v2Explanation.overallScore - v1Score,
        percentageDifference: ((v2Explanation.overallScore - v1Score) / v1Score) * 100 || 0,
      };
    } catch (error) {
      console.error('Error comparing algorithms:', error);
      throw error;
    }
  }

  // Private helper methods

  private async calculateHealthFactors(petId: string, pet: any): Promise<HealthScoreFactors> {
    // Get health metrics for the pet
    const metricsResult = await query(
      'SELECT * FROM health_metrics WHERE pet_id = $1 ORDER BY created_at DESC',
      [petId],
    );

    const metrics = metricsResult.rows || [];

    const factors: HealthScoreFactors = {
      ageScore: this.calculateAgeScore(pet.date_of_birth),
      vacccinationStatus: this.calculateVaccinationScore(metrics),
      medicalHistory: this.calculateMedicalHistoryScore(metrics),
      preventiveCare: this.calculatePreventiveCareScore(metrics),
      weight: this.calculateWeightScore(pet, metrics),
      activityLevel: this.calculateActivityLevelScore(metrics),
      dietQuality: this.calculateDietQualityScore(metrics),
      dentalHealth: this.calculateDentalHealthScore(metrics),
      mentalWellbeing: this.calculateMentalWellbeingScore(metrics),
    };

    return factors;
  }

  private calculateAgeScore(dateOfBirth: string): number {
    if (!dateOfBirth) return 50;

    const birthDate = new Date(dateOfBirth);
    const now = new Date();
    const ageInYears = (now.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

    // Pets are healthiest between 2-7 years
    if (ageInYears < 2) {
      return 70 + ageInYears * 10; // Young pets: 70-90
    } else if (ageInYears <= 7) {
      return 90; // Prime years: 90
    } else if (ageInYears <= 10) {
      return 80; // Mature: 80
    } else {
      return Math.max(50, 80 - (ageInYears - 10) * 5); // Senior: declining
    }
  }

  private calculateVaccinationScore(metrics: any[]): number {
    const recentMetric = metrics[0];
    if (!recentMetric) return 50;

    const data = recentMetric.data || {};
    const vaccinationsUpToDate = data.vaccinations_up_to_date === true;
    const lastVaccineDate = data.last_vaccine_date ? new Date(data.last_vaccine_date) : null;

    let score = 50;
    if (vaccinationsUpToDate) score += 40;
    if (
      lastVaccineDate &&
      new Date().getTime() - lastVaccineDate.getTime() < 365 * 24 * 60 * 60 * 1000
    ) {
      score += 10;
    }

    return Math.min(100, score);
  }

  private calculateMedicalHistoryScore(metrics: any[]): number {
    if (metrics.length === 0) return 70;

    const chronicConditions = metrics.filter((m) => m.data?.chronic_conditions).length;
    const pastIssues = metrics.filter((m) => m.data?.past_health_issues).length;

    let score = 100;
    score -= Math.min(30, chronicConditions * 10);
    score -= Math.min(15, pastIssues * 2);

    return Math.max(20, score);
  }

  private calculatePreventiveCareScore(metrics: any[]): number {
    if (metrics.length === 0) return 50;

    const recentCheckups = metrics.filter((m) => {
      const date = new Date(m.created_at);
      return new Date().getTime() - date.getTime() < 365 * 24 * 60 * 60 * 1000;
    }).length;

    return Math.min(100, 50 + recentCheckups * 15);
  }

  private calculateWeightScore(pet: any, metrics: any[]): number {
    if (!pet.ideal_weight || !metrics[0]) return 70;

    const currentWeight = metrics[0].data?.weight || pet.weight;
    const idealWeight = pet.ideal_weight;

    const difference = Math.abs(currentWeight - idealWeight) / idealWeight;

    if (difference < 0.1) return 95; // Within 10%
    if (difference < 0.2) return 80; // Within 20%
    if (difference < 0.3) return 60; // Within 30%
    return Math.max(30, 50 - difference * 100);
  }

  private calculateActivityLevelScore(metrics: any[]): number {
    if (metrics.length === 0) return 60;

    const recentMetric = metrics[0];
    const activityLevel = recentMetric.data?.activity_level || 'moderate';

    switch (activityLevel) {
      case 'high':
        return 95;
      case 'moderate':
        return 85;
      case 'low':
        return 60;
      default:
        return 70;
    }
  }

  private calculateDietQualityScore(metrics: any[]): number {
    if (metrics.length === 0) return 70;

    const recentMetric = metrics[0];
    const dietQuality = recentMetric.data?.diet_quality || 'good';

    switch (dietQuality) {
      case 'excellent':
        return 95;
      case 'good':
        return 80;
      case 'fair':
        return 60;
      case 'poor':
        return 30;
      default:
        return 70;
    }
  }

  private calculateDentalHealthScore(metrics: any[]): number {
    if (metrics.length === 0) return 70;

    const recentMetric = metrics[0];
    const dentalHealth = recentMetric.data?.dental_health || 'healthy';

    switch (dentalHealth) {
      case 'healthy':
        return 90;
      case 'needs_cleaning':
        return 70;
      case 'disease':
        return 40;
      default:
        return 70;
    }
  }

  private calculateMentalWellbeingScore(metrics: any[]): number {
    if (metrics.length === 0) return 75;

    const recentMetric = metrics[0];
    const mentalState = recentMetric.data?.mental_wellbeing || 'good';

    switch (mentalState) {
      case 'excellent':
        return 95;
      case 'good':
        return 80;
      case 'stressed':
        return 50;
      case 'anxious':
        return 40;
      default:
        return 75;
    }
  }

  private async calculateConfidenceInterval(
    petId: string,
    score: number,
  ): Promise<{ min: number; max: number }> {
    // Get number of data points for this pet
    const dataPointsResult = await query(
      'SELECT COUNT(*) as count FROM health_metrics WHERE pet_id = $1',
      [petId],
    );

    const dataPoints = dataPointsResult.rows[0]?.count || 0;

    // Confidence interval narrows with more data
    let margin = 15;
    if (dataPoints > 10) margin = 10;
    if (dataPoints > 20) margin = 5;
    if (dataPoints > 50) margin = 3;

    return {
      min: Math.max(0, score - margin),
      max: Math.min(100, score + margin),
    };
  }

  private async deriveWeightsFromData(
    data: any,
    species: string,
    breed?: string,
  ): Promise<typeof this.DEFAULT_WEIGHTS> {
    // Simple weight derivation based on data statistics
    // In production, use proper ML model like random forest or gradient boosting

    const weights = { ...this.DEFAULT_WEIGHTS };

    // Adjust weights based on correlation with health outcomes
    // This is a simplified example
    if (species === 'Canine') {
      weights.vaccination = 0.25;
      weights.age = 0.12;
    } else if (species === 'Feline') {
      weights.vaccination = 0.22;
      weights.activityLevel = 0.12;
    }

    return weights;
  }

  private formatFactorName(factorName: string): string {
    return factorName
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

export default new HealthScoringServiceV2();
