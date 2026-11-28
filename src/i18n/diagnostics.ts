/**
 * Translation completeness diagnostics.
 *
 * A key present in the base (en) bundle but absent from a locale renders from
 * the English fallback at runtime. These helpers find those keys so they can be
 * surfaced in development and in the release check script.
 *
 * Kept free of i18next imports so scripts/check-translations.ts can reuse them
 * under ts-node.
 */

export type TranslationBundle = { [key: string]: unknown };

export interface TranslationGaps {
  /** Keys in the base locale with no value in the target locale. */
  missing: string[];
  /** Keys in the target locale that the base locale does not define. */
  extra: string[];
}

export function flattenKeys(bundle: TranslationBundle, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(bundle)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as TranslationBundle, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

export function getTranslationGaps(
  base: TranslationBundle,
  locale: TranslationBundle,
): TranslationGaps {
  const baseKeys = flattenKeys(base);
  const localeKeys = flattenKeys(locale);
  const baseSet = new Set(baseKeys);
  const localeSet = new Set(localeKeys);

  return {
    missing: baseKeys.filter((key) => !localeSet.has(key)),
    extra: localeKeys.filter((key) => !baseSet.has(key)),
  };
}

/** Human-readable fallback summary, or null when the locale is complete. */
export function formatFallbackUsage(
  lang: string,
  gaps: TranslationGaps,
  maxKeys = 10,
): string | null {
  if (gaps.missing.length === 0) return null;

  const shown = gaps.missing.slice(0, maxKeys).join(', ');
  const remaining = gaps.missing.length - maxKeys;
  const suffix = remaining > 0 ? `, and ${remaining} more` : '';
  return `[i18n] "${lang}" falls back to English for ${gaps.missing.length} key(s): ${shown}${suffix}`;
}
