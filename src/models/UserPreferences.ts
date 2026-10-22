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

export type QuietHoursConfig = {
  enabled: boolean;
  /** Minutes from midnight (0-1439) when quiet hours begin. */
  startMinutes: number;
  /** Minutes from midnight (0-1439) when quiet hours end. */
  endMinutes: number;
  /** IANA timezone identifier used to evaluate the quiet window. */
  timezone: string;
};

export interface UserPreferences {
  language: string;
  theme: Theme;
  notificationsEnabled: boolean;
  reminderLeadTimeDays: number;
  notificationPreferences: NotificationPreferences;
  quietHours: QuietHoursConfig;
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
  quietHours: {
    enabled: false,
    startMinutes: 22 * 60,
    endMinutes: 7 * 60,
    timezone: 'UTC',
  },
};