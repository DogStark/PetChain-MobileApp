import apiClient from './apiClient';
import type { ApiResponse } from '../../backend/types/api';

export type HealthAlertFeedback = 'helpful' | 'not_helpful' | 'already_known' | 'false_alarm';

export interface HealthPredictionAlert {
  id: string;
  petId: string;
  ownerId: string;
  predictedIssue: string;
  riskScore: number;
  riskLevel: 'medium' | 'high';
  contributingFactors: string[];
  modelVersion: string;
  status: 'active' | 'dismissed';
  createdAt: string;
  dismissedAt?: string;
  feedback?: HealthAlertFeedback;
  feedbackNotes?: string;
}

export async function getHealthAlerts(status: 'active' | 'all' = 'active') {
  const response = await apiClient.get<ApiResponse<HealthPredictionAlert[]>>('/health-alerts', {
    params: { status },
  });
  return response.data.data;
}

export async function runDailyHealthPredictions() {
  const response = await apiClient.post<ApiResponse<HealthPredictionAlert[]>>(
    '/health-alerts/run-daily',
  );
  return response.data.data;
}

export async function dismissHealthAlert(
  id: string,
  feedback?: HealthAlertFeedback,
  feedbackNotes?: string,
) {
  const response = await apiClient.post<ApiResponse<HealthPredictionAlert>>(
    `/health-alerts/${id}/dismiss`,
    { feedback, feedbackNotes },
  );
  return response.data.data;
}
