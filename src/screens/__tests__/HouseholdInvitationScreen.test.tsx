/**
 * Tests for HouseholdInvitationScreen recovery states — main accept flow,
 * denial/stale-data states, and offline retry.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import HouseholdInvitationScreen from '../HouseholdInvitationScreen';
import {
  acceptHouseholdInvitation,
  HouseholdInvitationError,
} from '../../services/familySharingService';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../services/familySharingService', () => ({
  acceptHouseholdInvitation: jest.fn(),
  declineHouseholdInvitation: jest.fn(),
  HouseholdInvitationError: class HouseholdInvitationError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly recoveryState: string,
      public readonly status?: number,
    ) {
      super(message);
      this.name = 'HouseholdInvitationError';
    }
  },
}));

const mockAccept = acceptHouseholdInvitation as jest.Mock;

const TOKEN = 'inv-token-456';

function renderScreen(overrides: Partial<Parameters<typeof HouseholdInvitationScreen>[0]> = {}) {
  const props = {
    token: TOKEN,
    onBack: jest.fn(),
    onJoined: jest.fn(),
    ...overrides,
  };
  return { ...render(<HouseholdInvitationScreen {...props} />), props };
}

beforeEach(() => {
  mockAccept.mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HouseholdInvitationScreen', () => {
  it('shows loading while accepting and navigates on success', async () => {
    const { getByText, props, queryByText } = renderScreen();
    expect(queryByText('Joining household…')).toBeTruthy();

    mockAccept.mockResolvedValue({
      familyGroupId: 'group-1',
      role: 'viewer',
    });

    await waitFor(() => expect(getByText('Welcome to the household!')).toBeTruthy());
    fireEvent.press(getByText('View Household'));
    expect(props.onJoined).toHaveBeenCalledWith('group-1');
  });

  it.each([
    ['expired', 'Invitation expired', 'Ask the household owner to send you a new invitation.'],
    ['already_used', 'Invitation already used', 'You may already be a member of this household.'],
    ['revoked', 'Invitation revoked', 'Ask the household owner to send you a new invitation.'],
    [
      'wrong_account',
      'Wrong account',
      'Sign out and sign in with the account the invitation was addressed to.',
    ],
    ['not_found', 'Invitation not found', 'Ask the household owner to resend the invitation.'],
  ])('shows recovery steps for state %s', async (recovery, title, expectedStep) => {
    mockAccept.mockRejectedValue(
      new HouseholdInvitationError(`denied: ${recovery}`, 'INVITATION_EXPIRED', recovery, 410),
    );

    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText(title)).toBeTruthy());
    expect(getByText(new RegExp(expectedStep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
  });

  it('offers a retry for offline/network failures and retries on press', async () => {
    mockAccept
      .mockRejectedValueOnce(
        new HouseholdInvitationError('offline', 'NETWORK_ERROR', 'network'),
      )
      .mockResolvedValueOnce({ familyGroupId: 'group-9', role: 'viewer' });

    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText('Unable to connect')).toBeTruthy());

    fireEvent.press(getByText('Try Again'));
    await waitFor(() => expect(getByText('Welcome to the household!')).toBeTruthy());
    expect(mockAccept).toHaveBeenCalledTimes(2);
  });

  it('exposes an accessible back button in recovery states', async () => {
    mockAccept.mockRejectedValue(
      new HouseholdInvitationError('revoked', 'INVITATION_REVOKED', 'revoked', 410),
    );

    const { getByLabelText, getByText, props } = renderScreen();
    await waitFor(() => expect(getByText('Invitation revoked')).toBeTruthy());
    fireEvent.press(getByLabelText('Go back'));
    expect(props.onBack).toHaveBeenCalled();
  });
});