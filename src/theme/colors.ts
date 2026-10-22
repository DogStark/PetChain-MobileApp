import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
} from '@react-navigation/native';

export const lightTheme = {
  background: '#F5F7FA',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  cardElevated: '#FFFFFF',
  text: '#111827',
  secondaryText: '#374151',
  placeholder: '#596575',
  border: '#D1D5DB',
  primary: '#4CAF50', // brand color (unchanged)
  primaryMuted: '#E8F5E9',
  accent: '#0F766E', // adjusted for contrast
  info: '#1565C0', // adjusted for contrast
  infoMuted: '#E3F2FD',
  warning: '#92400E', // adjusted for contrast
  error: '#D32F2F', // adjusted for contrast
  success: '#15803D', // adjusted for contrast
  notification: '#15803D', // adjusted for contrast
  muted: '#E5E7EB',
  subtle: '#F8FAFC',
  input: '#F9FAFB',
  overlay: 'rgba(0,0,0,0.5)',
  shadow: '#000000',
  chartGrid: '#E5E7EB',
  chartAxis: '#596575',
  chartLine: '#1565C0',
  chartAnnotation: '#D32F2F',
  chartRangeFill: 'rgba(76, 175, 80, 0.18)',
  white: '#FFFFFF',
};

export const darkTheme = {
  background: '#0B1120',
  surface: '#111827',
  card: '#172033',
  cardElevated: '#1F2937',
  text: '#F8FAFC',
  secondaryText: '#E2E8F0',
  placeholder: '#94A3B8',
  border: '#3F4B5F',
  primary: '#81C784', // brand color (unchanged)
  primaryMuted: '#17351F',
  accent: '#34D399',
  info: '#90CAF9',
  infoMuted: '#102A43',
  warning: '#FBBF24',
  error: '#F87171',
  success: '#34D399',
  notification: '#34D399',
  muted: '#1E293B',
  subtle: '#0F172A',
  input: '#111827',
  overlay: 'rgba(0,0,0,0.72)',
  shadow: '#000000',
  chartGrid: '#334155',
  chartAxis: '#E2E8F0',
  chartLine: '#90CAF9',
  chartAnnotation: '#FCA5A5',
  chartRangeFill: 'rgba(129, 199, 132, 0.2)',
  white: '#FFFFFF',
};

export const navigationLightTheme = {
  ...NavigationDefaultTheme,
  colors: {
    ...NavigationDefaultTheme.colors,
    background: lightTheme.background,
    card: lightTheme.surface,
    text: lightTheme.text,
    border: lightTheme.border,
    primary: lightTheme.primary,
    notification: lightTheme.notification,
  },
};

export const navigationDarkTheme = {
  ...NavigationDarkTheme,
  colors: {
    ...NavigationDarkTheme.colors,
    background: darkTheme.background,
    card: darkTheme.card,
    text: darkTheme.text,
    border: darkTheme.border,
    primary: darkTheme.primary,
    notification: darkTheme.notification,
  },
};
