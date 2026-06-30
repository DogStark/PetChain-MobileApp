import api from './api';

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

export interface AlgorithmComparison {
  v1Score: number;
  v2Score: number;
  v2Explanation: HealthScoreExplanation;
  difference: number;
  percentageDifference: number;
}

class HealthScoringServiceV2 {
  /**
   * Calculate health score using v2 algorithm
   */
  async calculateHealthScore(petId: string): Promise<HealthScoreExplanation> {
    try {
      const response = await api.get(`/api/health-scoring/v2/pet/${petId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to calculate health score:', error);
      throw error;
    }
  }

  /**
   * Compare v1 and v2 algorithms for A/B testing
   */
  async compareAlgorithms(petId: string): Promise<AlgorithmComparison> {
    try {
      const response = await api.get(`/api/health-scoring/v2/compare/${petId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to compare algorithms:', error);
      throw error;
    }
  }

  /**
   * Update health score incrementally as new data arrives
   */
  async updateHealthScore(
    petId: string,
    newFactor: Record<string, unknown>,
  ): Promise<HealthScoreExplanation> {
    try {
      const response = await api.post(`/api/health-scoring/v2/update/${petId}`, {
        newFactor,
      });
      return response.data;
    } catch (error) {
      console.error('Failed to update health score:', error);
      throw error;
    }
  }

  /**
   * Get health score history for a pet
   */
  async getScoreHistory(
    petId: string,
    days: number = 90,
  ): Promise<Array<{
    score: number;
    date: string;
    explanation?: HealthScoreExplanation;
    confidenceMin?: number;
    confidenceMax?: number;
  }>> {
    try {
      const response = await api.get(`/api/health-scoring/v2/history/${petId}?days=${days}`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch health score history:', error);
      throw error;
    }
  }

  /**
   * Get score color based on value
   */
  getScoreColor(score: number): string {
    if (score >= 80) return '#28a745'; // Green - Excellent
    if (score >= 60) return '#ffc107'; // Yellow - Good
    if (score >= 40) return '#fd7e14'; // Orange - Fair
    return '#dc3545'; // Red - Poor
  }

  /**
   * Get score label based on value
   */
  getScoreLabel(score: number): string {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Needs Attention';
  }

  /**
   * Get recommendations based on factors
   */
  getRecommendations(explanation: HealthScoreExplanation): string[] {
    const recommendations: string[] = [];

    // Check each factor for recommendations
    for (const factor of explanation.factors) {
      if (factor.score < 50) {
        switch (factor.name.toLowerCase()) {
          case 'age score':
            recommendations.push('Monitor age-related health changes with regular vet visits');
            break;
          case 'vaccination status':
            recommendations.push('Update vaccinations according to veterinary recommendations');
            break;
          case 'medical history':
            recommendations.push('Work with your vet to manage existing health conditions');
            break;
          case 'preventive care':
            recommendations.push('Schedule regular preventive care appointments');
            break;
          case 'weight':
            recommendations.push('Consult with your vet about weight management and nutrition');
            break;
          case 'activity level':
            recommendations.push('Increase daily exercise and playtime');
            break;
          case 'diet quality':
            recommendations.push('Review diet quality with your veterinarian');
            break;
          case 'dental health':
            recommendations.push('Schedule dental cleaning and improve oral hygiene');
            break;
          case 'mental wellbeing':
            recommendations.push('Increase enrichment activities and social interaction');
            break;
        }
      }
    }

    return recommendations.slice(0, 3); // Return top 3 recommendations
  }

  /**
   * Format confidence interval for display
   */
  formatConfidenceInterval(interval: { min: number; max: number }): string {
    return `${interval.min}–${interval.max}`;
  }

  /**
   * Check if algorithm change significantly differs from v1
   */
  isSignificantDifference(comparison: AlgorithmComparison): boolean {
    return Math.abs(comparison.percentageDifference) > 10;
  }
}

export default new HealthScoringServiceV2();
