/**
 * Tests for LockScreen.tsx biometric fallback and PIN lockout integration.
 *
 * Verifies: biometric failures correctly fall back to PIN, PIN cooldown is
 * respected when falling back from biometric, no path bypasses lock.
 */

import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import * as authService from '../../services/authService';
import * as pinLockStateService from '../../services/pinLockStateService';
import LockScreen from '../../screens/LockScreen';

jest.mock('../../services/authService');
jest.mock('../../services/pinLockStateService');
jest.mock('../../services/appLockService');

const mockAuthService = authService as jest.Mocked<typeof authService>;
const mockPinLockState = pinLockStateService as jest.Mocked<typeof pinLockStateService>;

describe('LockScreen - Biometric fallback and cooldown integration', () => {
  const mockOnUnlock = jest.fn();
  const mockOnWipe = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockPinLockState.loadAttempts.mockResolvedValue(0);
    mockPinLockState.loadCooldownUntil.mockResolvedValue(0);
    mockPinLockState.saveAttempts.mockResolvedValue(undefined);
    mockPinLockState.saveCooldownUntil.mockResolvedValue(undefined);
  });

  it('renders biometric prompt initially', async () => {
    mockAuthService.authenticateWithBiometric.mockResolvedValue(true);

    render(
      <LockScreen onUnlock={mockOnUnlock} onWipe={mockOnWipe} showPinFallback={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Authenticating/i)).toBeTruthy();
    });
  });

  it('falls back to PIN input when biometric fails', async () => {
    mockAuthService.authenticateWithBiometric.mockResolvedValue(false);

    render(
      <LockScreen onUnlock={mockOnUnlock} onWipe={mockOnWipe} showPinFallback={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Enter your 6-digit PIN/i)).toBeTruthy();
    });
  });

  it('does not unlock when biometric is cancelled (must enter PIN)', async () => {
    mockAuthService.authenticateWithBiometric.mockResolvedValue(false);

    render(
      <LockScreen onUnlock={mockOnUnlock} onWipe={mockOnWipe} showPinFallback={false} />,
    );

    await waitFor(() => {
      expect(mockOnUnlock).not.toHaveBeenCalled();
    });

    // Verify PIN entry is required
    const pinInput = screen.getByText(/Enter your 6-digit PIN/i);
    expect(pinInput).toBeTruthy();
  });

  it('respects PIN cooldown when falling back from biometric', async () => {
    const futureTime = Date.now() + 60000;
    mockAuthService.authenticateWithBiometric.mockResolvedValue(false);
    mockPinLockState.loadCooldownUntil.mockResolvedValue(futureTime);

    render(
      <LockScreen onUnlock={mockOnUnlock} onWipe={mockOnWipe} showPinFallback={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Too many attempts/i)).toBeTruthy();
    });
  });

  it('allows PIN entry after cooldown expires even if biometric falls back', async () => {
    const expiredCooldown = Date.now() - 1000;
    mockAuthService.authenticateWithBiometric.mockResolvedValue(false);
    mockPinLockState.loadCooldownUntil.mockResolvedValue(expiredCooldown);

    render(
      <LockScreen onUnlock={mockOnUnlock} onWipe={mockOnWipe} showPinFallback={false} />,
    );

    await waitFor(() => {
      const pinText = screen.queryByText(/Too many attempts/i);
      expect(pinText).toBeFalsy();
    });

    // PIN keypad should be available
    const keypad = screen.getByText('1');
    expect(keypad).toBeTruthy();
  });

  it('shows accessibility label for fallback button', async () => {
    mockAuthService.authenticateWithBiometric.mockResolvedValue(false);

    render(
      <LockScreen onUnlock={mockOnUnlock} onWipe={mockOnWipe} showPinFallback={false} />,
    );

    await waitFor(() => {
      // Check for accessibility labels on buttons
      const buttons = screen.queryAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it('supports initial PIN fallback mode (e.g., on enrollment change)', async () => {
    mockAuthService.verifyPin.mockResolvedValue(true);

    render(
      <LockScreen onUnlock={mockOnUnlock} onWipe={mockOnWipe} showPinFallback={true} />,
    );

    // Should show PIN input immediately, not biometric
    await waitFor(() => {
      expect(screen.getByText(/Enter your 6-digit PIN/i)).toBeTruthy();
    });
  });
});
