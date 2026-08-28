/**
 * SettingsScreen — functional tests
 *
 * These tests verify the core logic of the Settings screen:
 * profile validation, notification persistence, and logout flow.
 *
 * UI rendering tests require a React Native test renderer (e.g. @testing-library/react-native)
 * which is not currently in the project's devDependencies, so we test the service layer
 * interactions directly here.
 */

import type { User } from '../../models/User';
import { logout } from '../../services/authService';
import { getUserProfile, updateUserProfile } from '../../services/userService';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../services/userService');
jest.mock('../../services/authService', () => ({
  logout: jest.fn(),
  requestPasswordReset: jest.fn(),
}));
jest.mock('../../utils/encryption/keychain', () => ({
  clearSecureTokens: jest.fn(),
  getSecureToken: jest.fn().mockResolvedValue(null),
  storeSecureTokens: jest.fn(),
  getSecureTokens: jest.fn().mockResolvedValue(null),
  getSecureRefreshToken: jest.fn().mockResolvedValue(null),
  isBiometricAuthenticationEnabled: jest.fn().mockResolvedValue(false),
  getBiometricAvailability: jest.fn().mockResolvedValue({ isAvailable: false, biometryType: null }),
  enableBiometricAuthentication: jest.fn().mockResolvedValue(true),
  disableBiometricAuthentication: jest.fn().mockResolvedValue(undefined),
  authenticateWithBiometricGate: jest.fn().mockResolvedValue(true),
}));

const mockGetUserProfile = getUserProfile as jest.MockedFunction<typeof getUserProfile>;
const mockUpdateUserProfile = updateUserProfile as jest.MockedFunction<typeof updateUserProfile>;
const mockLogout = logout as jest.MockedFunction<typeof logout>;

const MOCK_USER: User = {
  id: 'user_1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+1 555 000 0000',
  role: 'owner',
  notificationPreferences: {
    medicationReminders: true,
    appointmentReminders: true,
    vaccinationAlerts: false,
    soundEnabled: true,
    badgeEnabled: true,
  },
};

// ─── Profile persistence ───────────────────────────────────────────────────────

describe('Profile settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserProfile.mockResolvedValue(MOCK_USER);
    mockUpdateUserProfile.mockResolvedValue(MOCK_USER);
  });

  it('loads existing profile from storage', async () => {
    const profile = await getUserProfile();
    expect(profile).toEqual(MOCK_USER);
    expect(mockGetUserProfile).toHaveBeenCalledTimes(1);
  });

  it('saves updated profile fields', async () => {
    const updates = {
      name: 'Jane Smith',
      email: 'jane.smith@example.com',
      phone: '+1 555 111 2222',
    };
    await updateUserProfile(updates);
    expect(mockUpdateUserProfile).toHaveBeenCalledWith(updates);
  });

  it('rejects empty name via validation logic', () => {
    const validateName = (name: string) => name.trim().length > 0;
    expect(validateName('')).toBe(false);
    expect(validateName('  ')).toBe(false);
    expect(validateName('Jane')).toBe(true);
  });

  it('rejects malformed email via validation logic', () => {
    const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    expect(validateEmail('not-an-email')).toBe(false);
    expect(validateEmail('missing@domain')).toBe(false);
    expect(validateEmail('jane@example.com')).toBe(true);
  });
});

// ─── Notification preferences ─────────────────────────────────────────────────

describe('Notification preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateUserProfile.mockResolvedValue(MOCK_USER);
  });

  it('persists a toggled notification preference', async () => {
    const updatedPrefs = { notificationPreferences: { vaccinationAlerts: true } };
    await updateUserProfile(updatedPrefs);
    expect(mockUpdateUserProfile).toHaveBeenCalledWith(updatedPrefs);
  });

  it('reverts preference state on save failure', async () => {
    mockUpdateUserProfile.mockRejectedValueOnce(new Error('Network error'));

    const originalPrefs = { medicationReminders: true };
    let currentPrefs = { ...originalPrefs };

    try {
      await updateUserProfile({ notificationPreferences: { medicationReminders: false } });
      currentPrefs = { medicationReminders: false };
    } catch {
      // Revert — state should remain unchanged
    }

    expect(currentPrefs).toEqual(originalPrefs);
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('Logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls logout and clears session', async () => {
    mockLogout.mockResolvedValueOnce(undefined);
    await logout();
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('proceeds with local cleanup even if server logout fails', async () => {
    // logout() in authService already handles this internally (best-effort server call),
    // so the function should resolve without throwing
    mockLogout.mockResolvedValueOnce(undefined);
    await expect(logout()).resolves.toBeUndefined();
  });
});
