import type { AxiosResponse } from 'axios';

import apiClient from './apiClient';

export type LostFoundType = 'lost' | 'found';

export interface LostFoundLocation {
  latitude: number;
  longitude: number;
}

export interface LostFoundReport {
  id: string;
  type: LostFoundType;
  title: string;
  description: string;
  species: string;
  breed?: string;
  photoUrl?: string;
  location: LostFoundLocation;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface ListResponse {
  data: LostFoundReport[];
  total: number;
}

const BASE_URL = '/lost-found';

export async function getLostFoundReports(params?: {
  type?: LostFoundType;
  species?: string;
  breed?: string;
  radiusKm?: number;
  latitude?: number;
  longitude?: number;
}): Promise<{ reports: LostFoundReport[]; total: number }> {
  const response: AxiosResponse<ApiResponse<ListResponse>> = await apiClient.get(
    `${BASE_URL}/reports`,
    { params },
  );
  const payload = response.data.data;
  return { reports: payload.data ?? [], total: payload.total };
}

export async function getReportMatches(
  reportId: string,
  radiusKm?: number,
): Promise<{ reports: LostFoundReport[]; total: number }> {
  const response: AxiosResponse<ApiResponse<ListResponse>> = await apiClient.get(
    `${BASE_URL}/reports/${encodeURIComponent(reportId)}/matches`,
    {
      params: { radiusKm },
    },
  );
  const payload = response.data.data;
  return { reports: payload.data ?? [], total: payload.total };
}

export async function createLostFoundReport(data: {
  type: LostFoundType;
  title: string;
  description: string;
  species: string;
  breed?: string;
  photoUrl?: string;
  location: LostFoundLocation;
}): Promise<LostFoundReport> {
  const response: AxiosResponse<ApiResponse<{ data: LostFoundReport }>> = await apiClient.post(
    `${BASE_URL}/reports`,
    data,
  );
  return response.data.data.data;
}

export async function updateMyLocation(location: LostFoundLocation): Promise<void> {
  await apiClient.post(`${BASE_URL}/location`, location);
}

const lostFoundService = {
  getLostFoundReports,
  getReportMatches,
  createLostFoundReport,
  updateMyLocation,
};

export default lostFoundService;
