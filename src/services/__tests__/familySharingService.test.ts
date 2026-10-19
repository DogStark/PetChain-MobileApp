/**
 * Tests for familySharingService household-invitation API and its
 * server-confirmed recovery-state mapping.
 *
 * Covers: main accept/decline flow, each denial state (expired, already-used,
 * revoked, wrong-account, not-found), and offline/unknown retry boundaries.
 */

import apiClient from '../apiClient';
import {
  acceptHouseholdInvitation,
  declineHouseholdInvitation,
  HouseholdInvitationError,
} from '../familySharingService';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const apiPost = apiClient.post as jest.Mock;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TOKEN = 'inv-token-123';

function axiosError(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), {
    isAxiosError: true,
    response: { status, data: { error: { code, message } } },
  });
}

function offlineError(): Error {
  return Object.assign(new Error('Network request failed'), {
    isAxiosError: true,
    response: undefined,
  });
}

beforeEach(() => {
  apiPost.mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('acceptHouseholdInvitation', () => {
  it('returns the accepted membership on success', async () => {
    const result = {
      id: 'member-1',
      familyGroupId: 'group-1',
      userId: 'user-1',
      role: 'viewer',
      status: 'accepted',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    apiPost.mockResolvedValue({ data: result });

    await expect(acceptHouseholdInvitation(TOKEN)).resolves.toEqual(result);
    expect(apiPost).toHaveBeenCalledWith(
      `/family-sharing/invitations/${TOKEN}/accept`,
    );
  });

  it.each([
    ['INVITATION_EXPIRED', 410, 'expired'],
    ['INVITATION_ALREADY_USED', 409, 'already_used'],
    ['INVITATION_REVOKED', 410, 'revoked'],
    ['INVITATION_WRONG_ACCOUNT', 403, 'wrong_account'],
    ['INVITATION_NOT_FOUND', 404, 'not_found'],
  ])('maps server code %s to recovery state %s', async (code, status, recovery) => {
    apiPost.mockRejectedValue(axiosError(status, code, 'nope'));

    await expect(acceptHouseholdInvitation(TOKEN)).rejects.toMatchObject({
      name: 'HouseholdInvitationError',
      code,
      recoveryState: recovery,
      status,
    });
  });

  it('maps unknown server codes to the unknown recovery state', async () => {
    apiPost.mockRejectedValue(axiosError(500, 'INTERNAL_ERROR', 'boom'));

    await expect(acceptHouseholdInvitation(TOKEN)).rejects.toMatchObject({
      name: 'HouseholdInvitationError',
      recoveryState: 'unknown',
    });
  });

  it('maps offline/network failures to the network recovery state', async () => {
    apiPost.mockRejectedValue(offlineError());

    await expect(acceptHouseholdInvitation(TOKEN)).rejects.toMatchObject({
      name: 'HouseholdInvitationError',
      recoveryState: 'network',
    });
  });

  it('rethrows already-normalised invitation errors unchanged', async () => {
    const original = new HouseholdInvitationError('expired', 'INVITATION_EXPIRED', 'expired', 410);
    apiPost.mockRejectedValue(original);

    await expect(acceptHouseholdInvitation(TOKEN)).rejects.toBe(original);
  });
});

describe('declineHouseholdInvitation', () => {
  it('posts the decline endpoint on success', async () => {
    apiPost.mockResolvedValue({ data: null });

    await expect(declineHouseholdInvitation(TOKEN)).resolves.toBeUndefined();
    expect(apiPost).toHaveBeenCalledWith(
      `/family-sharing/invitations/${TOKEN}/decline`,
    );
  });

  it('maps denial codes to recovery states', async () => {
    apiPost.mockRejectedValue(axiosError(410, 'INVITATION_REVOKED', 'revoked'));

    const err = await declineHouseholdInvitation(TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(HouseholdInvitationError);
    expect(err.recoveryState).toBe('revoked');
  });
});