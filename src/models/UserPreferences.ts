export enum Theme {
  LIGHT = 'LIGHT',
  DARK = 'DARK',
  DARK_OLED = 'DARK_OLED',
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

/**
 * Bump whenever the analytics data collection scope changes; users who
 * consented to an older scope are asked again (#1391).
 */
export const ANALYTICS_CONSENT_SCOPE_VERSION = 1;

/** Plain-language list of what analytics collects, shown when asking. */
export const ANALYTICS_DATA_COLLECTED = [
  'Screens you open and features you use',
  'App errors and crashes',
  'Onboarding progress',
  'Non-identifying device details such as app version and language',
];

export type AnalyticsConsent = {
  granted: boolean;
  /** ANALYTICS_CONSENT_SCOPE_VERSION the user answered. */
  scopeVersion: number;
  /** ISO timestamp of the decision. */
  decidedAt: string;
};

/** Distance radius options (km) for vet search. */
export type VetSearchRadiusKm = 5 | 10 | 25 | 50;

/**
 * Persisted vet directory filters (#1383). An empty `specialties` array
 * means no specialty filter is applied.
 */
export type VetSearchFilters = {
  specialties: string[];
  radiusKm: VetSearchRadiusKm;
};

export interface UserPreferences {
  language: string;
  theme: Theme;
  notificationsEnabled: boolean;
  reminderLeadTimeDays: number;
  notificationPreferences: NotificationPreferences;
  quietHours: QuietHoursConfig;
  /** Analytics opt-in; null until the user has been asked (#1391). */
  analyticsConsent: AnalyticsConsent | null;
  /** Vet directory filters, persisted across sessions (#1383). */
  vetSearchFilters: VetSearchFilters;
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
  analyticsConsent: null,
  vetSearchFilters: {
    specialties: [],
    radiusKm: 25,
  },
};