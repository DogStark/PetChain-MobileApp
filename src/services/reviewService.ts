import * as StoreReview from 'expo-store-review';

import {
  engagementTracker,
  type EngagementEvent,
  NEGATIVE_EVENTS,
} from '../utils/engagementTracker';
import apiClient from '../../backend/services/apiClient';

const analytics = {
  track: (event: string, props?: object) => console.log('[analytics]', event, props),
};

export const reviewService = {
  async onEngagementEvent(event: EngagementEvent): Promise<void> {
    if (NEGATIVE_EVENTS.includes(event)) return;

    await engagementTracker.recordEvent(event);

    const eligible = await engagementTracker.isEligibleForPrompt();
    if (!eligible) return;

    const variant = await engagementTracker.getABVariant();
    if (variant === 'delayed') {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const isAvailable = await StoreReview.isAvailableAsync();
    if (!isAvailable) return;

    analytics.track('review_prompt_shown', { variant, trigger: event });
    await engagementTracker.recordPromptShown();

    await StoreReview.requestReview();
    analytics.track('review_prompt_completed', { variant, trigger: event });
  },
};

// --- Vet Reviews API ---

export interface VetReview {
  id: string;
  vet_id: string;
  user_id: string;
  rating: number;
  text: string;
  status: string;
  created_at: string;
  helpful_votes: number;
  not_helpful_votes: number;
}

export const submitVetReview = async (vetId: string, userId: string, rating: number, text: string): Promise<VetReview> => {
  const { data } = await apiClient.post<VetReview>(`/reviews`, { vetId, userId, rating, text });
  return data;
};

export const getVetReviews = async (vetId: string, page = 1): Promise<VetReview[]> => {
  const { data } = await apiClient.get<VetReview[]>(`/reviews`, { params: { vetId, page } });
  return data;
};

export const flagVetReview = async (reviewId: string, reason: string): Promise<VetReview> => {
  const { data } = await apiClient.post<VetReview>(`/reviews/${reviewId}/flag`, { reason });
  return data;
};

export const voteVetReview = async (reviewId: string, isHelpful: boolean): Promise<VetReview> => {
  const { data } = await apiClient.post<VetReview>(`/reviews/${reviewId}/vote`, { isHelpful });
  return data;
};

