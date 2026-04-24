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

export interface NotificationPreferences {
  medicationReminders?: boolean;
  appointmentReminders?: boolean;
  vaccinationAlerts?: boolean;
  reminderLeadTimeMinutes?: number;
  soundEnabled?: boolean;
  badgeEnabled?: boolean;
}

export interface AccessibilityPreferences {
  largeTextEnabled?: boolean;
  fontScaleMultiplier?: number;
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
  accessibilityPreferences?: AccessibilityPreferences;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateUserInput extends Omit<User, 'id' | 'createdAt' | 'updatedAt'> {
  password?: string;
}

export type UpdateUserInput = Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>;
