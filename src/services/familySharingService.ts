/**
 * Frontend family sharing (household) service — wraps the backend family-group
 * invitation endpoints.
 *
 * Invitation failures are server-confirmed: the backend classifies each denial
 * with a specific error code, which is mapped 1:1 to a {@link
 * HouseholdInvitationRecoveryState} so the UI can show actionable recovery steps
 * (expired, already-used, revoked, wrong-account). Offline/network failures are
 * preserved as a distinct `network` state so the caller can offer a retry
 * without fabricating a server decision.
 */
import apiClient from './apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HouseholdInvitationRecoveryState =
  | 'not_found'
  | 'expired'
  | 'already_used'
  | 'revoked'
  | 'wrong_account'
  | 'network'
  | 'unknown';

export interface HouseholdInvitationAcceptResult {
  id: string;
  familyGroupId: string;
  userId: string;
  role: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  updatedAt: string;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

const FAMILY_SHARING_ENDPOINTS = {
  acceptInvitation: (token: string) =>
    `/family-sharing/invitations/${encodeURIComponent(token)}/accept`,
  declineInvitation: (token: string) =>
    `/family-sharing/invitations/${encodeURIComponent(token)}/decline`,
};

// ─── Error ────────────────────────────────────────────────────────────────────

export class HouseholdInvitationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoveryState: HouseholdInvitationRecoveryState,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'HouseholdInvitationError';
  }
}

function mapServerCode(code: string, hasResponse: boolean): HouseholdInvitationRecoveryState {
  if (!hasResponse) return 'network';
  switch (code) {
    case 'INVITATION_NOT_FOUND':
      return 'not_found';
    case 'INVITATION_EXPIRED':
      return 'expired';
    case 'INVITATION_ALREADY_USED':
      return 'already_used';
    case 'INVITATION_REVOKED':
      return 'revoked';
    case 'INVITATION_WRONG_ACCOUNT':
      return 'wrong_account';
    default:
      return 'unknown';
  }
}

function toHouseholdInvitationError(error: unknown): HouseholdInvitationError {
  if (error instanceof HouseholdInvitationError) return error;
  if (error instanceof Error) {
    const axiosErr = error as { isAxiosError?: boolean; response?: unknown } & Error;
    if (axiosErr.isAxiosError) {
      const response = axiosErr.response as
        | { status?: number; data?: { error?: { code?: string; message?: string } } }
        | undefined;
      const status = response?.status;
      const code = response?.data?.error?.code ?? `HTTP_${status ?? 'UNKNOWN'}`;
      const message = response?.data?.error?.message ?? axiosErr.message;
      return new HouseholdInvitationError(message, code, mapServerCode(code, !!response), status);
    }
    return new HouseholdInvitationError(axiosErr.message, 'UNKNOWN_ERROR', 'unknown');
  }
  return new HouseholdInvitationError(
    'Unexpected household invitation error',
    'UNKNOWN_ERROR',
    'unknown',
  );
}

// ─── API ──────────────────────────────────────────────────────────────────────

/** Accept a household invitation by token. */
export async function acceptHouseholdInvitation(
  token: string,
): Promise<HouseholdInvitationAcceptResult> {
  try {
    const response = await apiClient.post<HouseholdInvitationAcceptResult>(
      FAMILY_SHARING_ENDPOINTS.acceptInvitation(token),
    );
    return response.data;
  } catch (error) {
    throw toHouseholdInvitationError(error);
  }
}

/** Decline a household invitation by token. */
export async function declineHouseholdInvitation(token: string): Promise<void> {
  try {
    await apiClient.post<null>(FAMILY_SHARING_ENDPOINTS.declineInvitation(token));
  } catch (error) {
    throw toHouseholdInvitationError(error);
  }
}