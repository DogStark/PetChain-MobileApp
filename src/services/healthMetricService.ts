import { deleteHealthMetricById, getHealthMetricsByPetId, upsertHealthMetric } from './localDB';
import type { ActivityLevel, HealthMetricEntry } from '../models/HealthMetric';

export type { HealthMetricEntry };

export function activityLevelToScore(level?: ActivityLevel): number | undefined {
  if (!level) return undefined;
  if (level === 'low') return 1;
  if (level === 'moderate') return 2;
  return 3;
}

export async function getHealthMetrics(petId: string): Promise<HealthMetricEntry[]> {
  return (await getHealthMetricsByPetId(petId)) as HealthMetricEntry[];
}

export async function saveHealthMetric(entry: HealthMetricEntry): Promise<void> {
  await upsertHealthMetric(
    entry as { id: string; petId: string; recordedAt: string; [k: string]: unknown },
  );
}

export async function deleteHealthMetric(id: string): Promise<void> {
  await deleteHealthMetricById(id);
}
