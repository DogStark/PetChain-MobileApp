export enum Theme {
  LIGHT = 'LIGHT',
  DARK = 'DARK',
  SYSTEM = 'SYSTEM',
}

export type NotificationPreferences = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
};

export interface UserPreferences {
  language: string;
  theme: Theme;
  notificationsEnabled: boolean;
  reminderLeadTimeDays: number;
  notificationPreferences: NotificationPreferences;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  language: 'en',
  theme: Theme.SYSTEM,
  notificationsEnabled: true,
  reminderLeadTimeDays: 1,
  notificationPreferences: {
    pushEnabled: true,
    emailEnabled: false,
    smsEnabled: false,
  },
};
