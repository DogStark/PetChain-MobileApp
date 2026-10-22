import apiClient from './apiClient';
import { getItem, setItem, removeItem } from './localDB';
import { savePreferences, cancelAllNotifications } from './notificationService';
import type { NotificationPreferences, User } from '../models/User';
import { clearSecureTokens } from '../utils/encryption/keychain';

const USER_PROFILE_KEY = '@user_profile';

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  medicationReminders: true,
  appointmentReminders: true,
  vaccinationAlerts: true,
  reminderLeadTimeMinutes: 60,
  soundEnabled: true,
  badgeEnabled: true,
};

export async function getUserProfile(): Promise<User | null> {
  const raw = await getItem(USER_PROFILE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function saveUserProfile(profile: User): Promise<User> {
  const normalized: User = {
    ...profile,
    notificationPreferences: {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(profile.notificationPreferences ?? {}),
    },
  };

  await setItem(USER_PROFILE_KEY, JSON.stringify(normalized));
  await savePreferences(normalized.notificationPreferences ?? {});
  return normalized;
}

export async function updateUserProfile(updates: Partial<Omit<User, 'id'>>): Promise<User> {
  const current = await getUserProfile();
  if (!current) {
    throw new Error('No user profile exists to update');
  }

  const updated: User = {
    ...current,
    ...updates,
    address: {
      ...(current.address ?? {}),
      ...(updates.address ?? {}),
    },
    emergencyContact: updates.emergencyContact || current.emergencyContact,
    notificationPreferences: {
      ...current.notificationPreferences,
      ...(updates.notificationPreferences ?? {}),
    },
  };

  await setItem(USER_PROFILE_KEY, JSON.stringify(updated));
  if (updates.notificationPreferences) {
    await savePreferences(updated.notificationPreferences ?? {});
  }

  return updated;
}

export async function clearUserProfile(): Promise<void> {
  await removeItem(USER_PROFILE_KEY);
}

// Delete account: server-side deletion + full local cascade
export async function deleteAccount(): Promise<void> {
  // 1. Server-side: delete user + all associated data (pets, records, medications, appointments)
  await apiClient.delete('/users/me');

  // 2. Cancel all scheduled notifications
  await cancelAllNotifications();

  // 3. Clear local profile
  await removeItem(USER_PROFILE_KEY);

  // 4. Clear secure tokens (ends session)
  await clearSecureTokens();
}
