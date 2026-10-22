import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  formatFallbackUsage,
  getTranslationGaps,
  type TranslationBundle,
} from './diagnostics';

declare const __DEV__: boolean;

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', rtl: false },
  { code: 'es', label: 'Español', rtl: false },
  { code: 'ar', label: 'العربية', rtl: true },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const RTL_LANGUAGES = new Set(SUPPORTED_LANGUAGES.filter((l) => l.rtl).map((l) => l.code));

export function isRTL(lang: string): boolean {
  return RTL_LANGUAGES.has(lang as LanguageCode);
}

/** Lazy-load a locale bundle. Returns null if already loaded or unknown. */
async function loadLocale(lang: string): Promise<void> {
  if (i18n.hasResourceBundle(lang, 'translation')) return;

  let bundle: { default: Record<string, unknown> };
  switch (lang) {
    case 'en':
      bundle = await import('./locales/en');
      break;
    case 'es':
      bundle = await import('./locales/es');
      break;
    case 'ar':
      bundle = await import('./locales/ar');
      break;
    default:
      return;
  }
  i18n.addResourceBundle(lang, 'translation', bundle.default, true, true);
}

i18n.use(initReactI18next).init({
  // Start with no resources — bundles are loaded on demand
  resources: {},
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // i18next pluralization uses the `_one`, `_other` (etc.) suffix convention.
  // Arabic has 6 plural forms; i18next handles them via the `ar` plural rule.
  pluralSeparator: '_',
});

// Eagerly load the default language so the app is ready on first render
void loadLocale('en').then(() => {
  i18n.addResourceBundle('en', 'translation', {}, true, false);
  // Re-trigger so components re-render with the loaded bundle
  void i18n.reloadResources(['en']);
});

/** Apply the routine calendar strings to a locale after its bundle loads. */
function ensureRoutineCalendarStrings(lang: string): void {
  const bundle = i18n.getResourceBundle(lang, 'translation') as
    | Record<string, unknown>
    | undefined;
  const withCalendar = mergeRoutineCalendarStrings(
    bundle ?? {},
    ROUTINE_CALENDAR_STRINGS as unknown as Record<string, unknown>,
  );
  i18n.addResourceBundle(lang, 'translation', { routineCalendar: withCalendar }, true, true);
}

/** Dev-only: warn about keys the active locale does not translate. */
function reportFallbackUsage(lang: string): void {
  if (!__DEV__ || lang === 'en') return;

  const base = (i18n.getResourceBundle('en', 'translation') ?? {}) as TranslationBundle;
  const bundle = (i18n.getResourceBundle(lang, 'translation') ?? {}) as TranslationBundle;
  const message = formatFallbackUsage(lang, getTranslationGaps(base, bundle));
  if (message) console.warn(message);
}

/** Change language, lazy-loading the bundle first, then applying RTL. */
export async function changeLanguage(lang: LanguageCode): Promise<void> {
  await loadLocale(lang);
  ensureRoutineCalendarStrings(lang);
  reportFallbackUsage(lang);
  await i18n.changeLanguage(lang);
}

export { loadLocale };

/**
 * Routine streak calendar strings.
 *
 * These are merged into every locale bundle at init time so the calendar
 * screen and its components can call `t('routineCalendar.*')` without
 * touching the per-locale files. Non-English locales fall back to the
 * English copy until translations land.
 */
export const ROUTINE_CALENDAR_STRINGS = {
  title: 'Routine streak calendar',
  subtitle: 'Completed, skipped, and unrecorded care days',
  monthPrevious: 'Previous month',
  monthNext: 'Next month',
  monthLabel: '{{month}} {{year}}',
  dayState: {
    completed: 'Completed',
    skipped: 'Skipped',
    unknown: 'Unknown',
    noData: 'No data recorded',
  },
  legend: {
    completed: 'Completed',
    skipped: 'Skipped',
    unknown: 'Unknown',
    noData: 'No data recorded',
  },
  streak: {
    summary: 'Current streak: {{count}} day',
    summary_other: 'Current streak: {{count}} days',
    longest: 'Longest streak: {{count}} day',
    longest_other: 'Longest streak: {{count}} days',
    none: 'No streak yet',
  },
  banner: {
    stale: 'Showing saved data. Reconnect to refresh.',
    offline: 'You are offline. Showing saved data.',
  },
  permission: {
    denied: 'You do not have permission to view this routine.',
    retry: 'Try again',
  },
  error: {
    loadFailed: 'Could not load the calendar.',
    retry: 'Retry',
  },
  a11y: {
    dayHint: '{{date}}: {{state}}. Double tap for details.',
    dayHintNoData: '{{date}}: no data recorded. Double tap for details.',
    monthHint: 'Month navigation. Swipe to change month.',
    streakHint: 'Streak summary: {{summary}}',
    bannerHint: 'Notice: {{message}}',
  },
} as const;

function mergeRoutineCalendarStrings(
  bundle: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const existing = (bundle.routineCalendar ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...fallback };
  for (const [key, value] of Object.entries(existing)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const base = (fallback[key] ?? {}) as Record<string, unknown>;
      merged[key] = { ...base, ...(value as Record<string, unknown>) };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

// Ensure the calendar strings exist for every supported locale. English gets
// the full copy; other locales get the same keys as placeholders so `t()`
// resolves instead of rendering raw keys.
for (const { code } of SUPPORTED_LANGUAGES) {
  const bundle = i18n.getResourceBundle(code, 'translation') as
    | Record<string, unknown>
    | undefined;
  const withCalendar = mergeRoutineCalendarStrings(
    bundle ?? {},
    ROUTINE_CALENDAR_STRINGS as unknown as Record<string, unknown>,
  );
  i18n.addResourceBundle(code, 'translation', { routineCalendar: withCalendar }, true, true);
}

export default i18n;
