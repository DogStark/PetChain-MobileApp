import { useEffect, useMemo, useState } from 'react';

import { getHealthMetrics, type HealthMetricEntry } from '../services/healthMetricService';
import healthMetricsService from '../services/healthScoringServiceV2';

export type HealthTrend = 'up' | 'stable' | 'down';

export interface UseHealthMetricsResult {
  metrics: HealthMetricEntry[];
  trend: HealthTrend;
  healthScore: number | null;
  isLoading: boolean;
  error: Error | null;
}

const getTrend = (metrics: HealthMetricEntry[]): HealthTrend => {
  if (metrics.length < 2) return 'stable';

  const sortedMetrics = [...metrics]
    .filter((metric) => typeof metric.weightKg === 'number')
    .sort(
      (firstMetric, secondMetric) =>
        new Date(firstMetric.recordedAt).getTime() - new Date(secondMetric.recordedAt).getTime(),
    );

  if (sortedMetrics.length < 2) return 'stable';

  const previousWeight = sortedMetrics[sortedMetrics.length - 2].weightKg ?? 0;
  const latestWeight = sortedMetrics[sortedMetrics.length - 1].weightKg ?? 0;

  if (latestWeight > previousWeight) return 'up';
  if (latestWeight < previousWeight) return 'down';
  return 'stable';
};

export function useHealthMetrics(petId: string): UseHealthMetricsResult {
  const [metrics, setMetrics] = useState<HealthMetricEntry[]>([]);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchMetrics = async () => {
      if (!petId) {
        setMetrics([]);
        setHealthScore(null);
        setError(null);
        return;
      }

      setIsLoading(true);
      try {
        const [fetchedMetrics, scoreExplanation] = await Promise.all([
          getHealthMetrics(petId),
          healthMetricsService.calculateHealthScore(petId),
        ]);

        if (!isMounted) return;

        setMetrics(fetchedMetrics);
        setHealthScore(scoreExplanation.overallScore);
        setError(null);
      } catch (fetchError) {
        if (!isMounted) return;

        setError(fetchError instanceof Error ? fetchError : new Error('Failed to fetch metrics'));
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void fetchMetrics();

    return () => {
      isMounted = false;
    };
  }, [petId]);

  const trend = useMemo(() => getTrend(metrics), [metrics]);

  return { metrics, trend, healthScore, isLoading, error };
}

export default useHealthMetrics;
