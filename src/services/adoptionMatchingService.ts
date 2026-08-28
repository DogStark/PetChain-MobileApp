/**
 * adoptionMatchingService — frontend
 *
 * Fetches lazy match scores for shelter pets. Each score is fetched
 * per card render so the list loads immediately without blocking.
 */

import apiClient from './apiClient';

export interface MatchCriterion {
  label: string;
  matched: boolean;
  explanation: string;
}

export interface AdoptionMatchResult {
  score: number; // 0–100
  criteria: MatchCriterion[];
}

const cache = new Map<string, AdoptionMatchResult>();

/**
 * Fetch the adoption compatibility score for a shelter pet.
 * Results are memoised in-memory for the session lifetime.
 * Returns null if the API call fails (score badge is hidden gracefully).
 */
export async function fetchMatchScore(shelterPetId: string): Promise<AdoptionMatchResult | null> {
  if (cache.has(shelterPetId)) {
    return cache.get(shelterPetId)!;
  }

  try {
    const res = await apiClient.get<{ success: boolean; data: AdoptionMatchResult }>(
      `/adoption/match-score/${encodeURIComponent(shelterPetId)}`,
    );
    if (res.data.success) {
      cache.set(shelterPetId, res.data.data);
      return res.data.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clear the in-memory score cache (e.g. when the adopter profile changes).
 */
export function clearMatchScoreCache(): void {
  cache.clear();
}
