export type UserRole = 'owner' | 'vet' | 'admin';

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship?: string;
  email?: string;
}

export interface PetNotificationOverride {
  petId: string;
  medicationReminders?: boolean;
  appointmentReminders?: boolean;
  vaccinationAlerts?: boolean;
}

export interface NotificationPreferences {
  // By type
  medicationReminders?: boolean;
  appointmentReminders?: boolean;
  vaccinationAlerts?: boolean;
  reminderLeadTimeMinutes?: number;
  // Sound / vibration
  soundEnabled?: boolean;
  vibrationEnabled?: boolean;
  badgeEnabled?: boolean;
  // Quiet hours
  quietHoursEnabled?: boolean;
  quietHoursStart?: string; // "HH:MM" 24-hour
  quietHoursEnd?: string; // "HH:MM" 24-hour
  // Per-pet overrides
  petOverrides?: PetNotificationOverride[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  profilePhoto?: string;
  address?: Address;
  emergencyContact?: EmergencyContact;
  notificationPreferences?: NotificationPreferences;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Factory to safely create a User object from raw data.
 */
export const createUser = (data: Partial<User>): User => ({
  id: data.id || '',
  email: data.email || '',
  name: data.name || 'User',
  phone: data.phone,
  role: data.role || 'owner',
  profilePhoto: data.profilePhoto,
  address: data.address,
  emergencyContact: data.emergencyContact,
  notificationPreferences: data.notificationPreferences,
  createdAt: data.createdAt,
  updatedAt: data.updatedAt,
});

export interface CreateUserInput extends Omit<User, 'id' | 'createdAt' | 'updatedAt'> {
  password?: string;
}

export type UpdateUserInput = Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>;
