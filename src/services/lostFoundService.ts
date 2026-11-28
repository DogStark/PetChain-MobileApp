import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AxiosResponse } from 'axios';

import apiClient from './apiClient';
import { isDraftExpired, type FoundPetDraft } from '../utils/foundPetReport';

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
  foundAt?: string;
  contactPreference?: FoundPetDraft['contactPreference'];
  consentToPublish?: boolean;
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

// Local-only draft: nothing leaves the device until the finder publishes.
const FOUND_DRAFT_KEY = '@lost_found_found_draft';

interface SavedFoundDraft {
  draft: FoundPetDraft;
  savedAt: number;
}

export async function saveFoundPetDraft(draft: FoundPetDraft, now = Date.now()): Promise<void> {
  const saved: SavedFoundDraft = { draft, savedAt: now };
  await AsyncStorage.setItem(FOUND_DRAFT_KEY, JSON.stringify(saved));
}

export async function loadFoundPetDraft(now = Date.now()): Promise<FoundPetDraft | null> {
  const raw = await AsyncStorage.getItem(FOUND_DRAFT_KEY);
  if (!raw) return null;

  try {
    const saved = JSON.parse(raw) as SavedFoundDraft;
    if (!isDraftExpired(saved.savedAt, now)) return saved.draft;
  } catch {
    // Corrupt entry: fall through and discard it.
  }

  await AsyncStorage.removeItem(FOUND_DRAFT_KEY);
  return null;
}

export async function clearFoundPetDraft(): Promise<void> {
  await AsyncStorage.removeItem(FOUND_DRAFT_KEY);
}

const lostFoundService = {
  getLostFoundReports,
  getReportMatches,
  createLostFoundReport,
  updateMyLocation,
  saveFoundPetDraft,
  loadFoundPetDraft,
  clearFoundPetDraft,
};

export default lostFoundService;
