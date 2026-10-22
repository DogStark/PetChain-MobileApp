import { getItem, setItem, removeItem } from '../localDB';
import { savePreferences } from '../notificationService';
import {
  getUserProfile,
  saveUserProfile,
  updateUserProfile,
  clearUserProfile,
} from '../userService';

jest.mock('../localDB', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../notificationService', () => ({
  savePreferences: jest.fn(),
}));

describe('userService', () => {
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'John Doe',
    phone: '+1 555 000 0000',
    role: 'owner' as const,
    profilePhoto: 'https://example.com/avatar.jpg',
    address: {
      street: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
    },
    emergencyContact: {
      name: 'Jane Doe',
      phone: '+1 555 111 2222',
      relationship: 'Sister',
      email: 'jane@example.com',
    },
    notificationPreferences: {
      medicationReminders: true,
      appointmentReminders: true,
      vaccinationAlerts: true,
      reminderLeadTimeMinutes: 60,
      soundEnabled: true,
      badgeEnabled: true,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserProfile', () => {
    it('should return parsed user profile if it exists', async () => {
      (getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockUser));
      const profile = await getUserProfile();
      expect(profile).toEqual(mockUser);
    });

    it('should return null if no profile exists', async () => {
      (getItem as jest.Mock).mockResolvedValue(null);
      const profile = await getUserProfile();
      expect(profile).toBeNull();
    });
  });

  describe('saveUserProfile', () => {
    it('should save user profile with default notification preferences', async () => {
      const userToSave = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'owner' as const,
      };
      const savedUser = await saveUserProfile(userToSave as any);

      expect(setItem).toHaveBeenCalledWith(
        '@user_profile',
        expect.stringContaining('"email":"test@example.com"'),
      );
      expect(savePreferences).toHaveBeenCalledWith(savedUser.notificationPreferences);
      expect(savedUser.notificationPreferences?.medicationReminders).toBe(true);
    });
  });

  describe('updateUserProfile', () => {
    it('should update existing profile', async () => {
      (getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockUser));
      const updates = { name: 'Jane Doe' };

      const updated = await updateUserProfile(updates);

      expect(updated.name).toBe('Jane Doe');
      expect(updated.email).toBe(mockUser.email);
      expect(setItem).toHaveBeenCalled();
    });

    it('should throw error if no profile exists', async () => {
      (getItem as jest.Mock).mockResolvedValue(null);
      await expect(updateUserProfile({ name: 'Jane Doe' })).rejects.toThrow(
        'No user profile exists to update',
      );
    });

    it('should update notification preferences and call savePreferences', async () => {
      (getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockUser));
      const updates = { notificationPreferences: { medicationReminders: false } };

      const updated = await updateUserProfile(updates as any);

      expect(updated.notificationPreferences?.medicationReminders).toBe(false);
      expect(savePreferences).toHaveBeenCalled();
    });

    it('should merge profile fields for nested contact data', async () => {
      (getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockUser));

      const updates = {
        profilePhoto: 'https://example.com/new-avatar.jpg',
        address: { city: 'Lagos', country: 'NG' },
        emergencyContact: { phone: '+234 800 000 0000' },
      };

      const updated = await updateUserProfile(updates as any);

      expect(updated.profilePhoto).toBe('https://example.com/new-avatar.jpg');
      expect(updated.address).toMatchObject({
        street: '123 Main St',
        city: 'Lagos',
        country: 'NG',
      });
      expect(updated.emergencyContact).toMatchObject({
        name: 'Jane Doe',
        phone: '+234 800 000 0000',
      });
    });
  });

  describe('clearUserProfile', () => {
    it('should remove profile from AsyncStorage', async () => {
      await clearUserProfile();
      expect(removeItem).toHaveBeenCalledWith('@user_profile');
    });
  });
});
