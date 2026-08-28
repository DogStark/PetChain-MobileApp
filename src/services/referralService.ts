import apiClient from './apiClient';
import type { ApiResponse } from '../../backend/types/api';

export interface ReferralStats {
  code: string;
  pendingConversions: number;
  successfulConversions: number;
  blockedConversions: number;
  earnedPremiumDays: number;
  availablePremiumDays: number;
  referrals: Array<{
    id: string;
    referredUserId: string;
    status: 'pending' | 'converted' | 'blocked';
    signupAt: string;
    convertedAt?: string;
    blockReason?: string;
  }>;
}

export async function getReferralStats(): Promise<ReferralStats> {
  const response = await apiClient.get<ApiResponse<ReferralStats>>('/referrals/me');
  return response.data.data;
}

export async function applyReferralCode(referralCode: string): Promise<void> {
  await apiClient.post('/referrals/apply', { referralCode });
}
