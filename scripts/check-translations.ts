#!/usr/bin/env ts-node
/**
 * CI script: fails with exit code 1 if any supported locale is missing
 * translation keys that exist in the base (en) locale.
 *
 * Usage:
 *   npx ts-node scripts/check-translations.ts
 *
 * Add to CI:
 *   - run: npx ts-node scripts/check-translations.ts
 */
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../src/i18n/locales');
const BASE_LOCALE = 'en';
const SUPPORTED = ['en', 'es'];

type NestedRecord = { [key: string]: string | NestedRecord };

export function flattenKeys(obj: NestedRecord, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      keys.push(...flattenKeys(v as NestedRecord, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

export function loadLocale(locale: string): NestedRecord {
  const localeFile = path.join(LOCALES_DIR, locale);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(localeFile) as { default?: NestedRecord } | NestedRecord;
  const data = (mod as { default?: NestedRecord }).default ?? (mod as NestedRecord);

  if (!data || typeof data !== 'object') {
    console.error(`Locale file did not export a valid object: ${localeFile}`);
    process.exit(1);
  }
  return data;
}

let hasErrors = false;

const baseKeys = flattenKeys(loadLocale(BASE_LOCALE));

for (const locale of SUPPORTED) {
  if (locale === BASE_LOCALE) continue;

  const localeKeys = new Set(flattenKeys(loadLocale(locale)));
  const missing = baseKeys.filter((k) => !localeKeys.has(k));

  if (missing.length > 0) {
    console.error(`\n[${locale}] Missing ${missing.length} translation key(s):`);
    for (const key of missing) {
      console.error(`  - ${key}`);
    }
    hasErrors = true;
  } else {
    console.log(`[${locale}] ✓ All ${baseKeys.length} keys present`);
  }
}

if (hasErrors) {
  console.error('\nTranslation check FAILED. Add missing keys before merging.');
  process.exit(1);
} else {
  console.log('\nTranslation check passed.');
}
