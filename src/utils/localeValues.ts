import i18n from '../i18n';

/** BCP 47 locale tag per language code — mirrors dateLocale.ts */
const LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  ar: 'ar-SA',
};

/** Locales that use imperial units (lb / °F) */
const IMPERIAL_LOCALES = new Set(['en-US', 'en-LR', 'en-MM']);

function locale(): string {
  return LOCALE_MAP[i18n.language] ?? i18n.language;
}

function isImperial(): boolean {
  return IMPERIAL_LOCALES.has(locale());
}

// ─── Weight ───────────────────────────────────────────────────────────────────

/** Convert kg → lb */
function kgToLb(kg: number): number {
  return kg * 2.20462;
}

/**
 * Format a weight value stored in kg.
 * Returns e.g. "4.5 kg" or "9.9 lb" depending on locale.
 */
export function formatWeight(kg: number): string {
  if (isImperial()) {
    return `${kgToLb(kg).toFixed(1)} lb`;
  }
  return `${kg.toFixed(1)} kg`;
}

/**
 * Parse a user-entered weight string back to kg for storage.
 * Assumes the value is in the locale's native unit.
 */
export function parseWeightToKg(value: number): number {
  return isImperial() ? value / 2.20462 : value;
}

/** Label for the weight unit in the current locale ("kg" or "lb") */
export function weightUnit(): string {
  return isImperial() ? 'lb' : 'kg';
}

// ─── Temperature ──────────────────────────────────────────────────────────────

/** Convert °C → °F */
function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

/**
 * Format a temperature value stored in °C.
 * Returns e.g. "38.5 °C" or "101.3 °F" depending on locale.
 */
export function formatTemperature(celsius: number): string {
  if (isImperial()) {
    return `${celsiusToFahrenheit(celsius).toFixed(1)} °F`;
  }
  return `${celsius.toFixed(1)} °C`;
}

/** Label for the temperature unit in the current locale ("°C" or "°F") */
export function temperatureUnit(): string {
  return isImperial() ? '°F' : '°C';
}

// ─── Currency ─────────────────────────────────────────────────────────────────

const CURRENCY_MAP: Record<string, string> = {
  'en-US': 'USD',
  'es-ES': 'EUR',
  'ar-SA': 'SAR',
};

/**
 * Format a numeric amount as a locale-aware currency string.
 * e.g. "$12.50" or "12,50 €"
 */
export function formatCurrency(amount: number, currencyOverride?: string): string {
  const currency = currencyOverride ?? CURRENCY_MAP[locale()] ?? 'USD';
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

// ─── Numbers ──────────────────────────────────────────────────────────────────

/**
 * Format a number for display in the active locale. Does not convert units:
 * callers pass values in their stored unit (e.g. kg or °C).
 */
export function formatLocaleNumber(value: number): string {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(value);
}

/**
 * Parse a number typed in the active locale, e.g. "1.234,5" (es) or "1,234.5" (en).
 * Returns null when the text is malformed or ambiguous (e.g. "12.5" in es, where "." groups
 * thousands) so callers can reject it instead of silently dropping or misreading it.
 */
export function parseLocaleNumber(raw: string): number | null {
  const tag = locale();
  const symbols = new Intl.NumberFormat(tag).formatToParts(-1234567.5);
  const group = symbols.find((p) => p.type === 'group')?.value ?? '';
  const decimal = symbols.find((p) => p.type === 'decimal')?.value ?? '.';
  const digits = new Intl.NumberFormat(tag, { useGrouping: false });

  // Strip whitespace and bidi marks, then map locale digits (e.g. Arabic-Indic) to ASCII
  let text = raw.replace(/[\s‎‏؜]/g, '');
  for (let d = 0; d <= 9; d++) {
    text = text.split(digits.format(d)).join(String(d));
  }

  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shape = new RegExp(
    `^-?(?:\\d+|\\d{1,3}(?:${escape(group)}\\d{3})+)(?:${escape(decimal)}\\d+)?$`,
  );
  if (!shape.test(text)) return null;

  if (group) text = text.split(group).join('');
  return Number(text.split(decimal).join('.'));
}

// ─── Address ──────────────────────────────────────────────────────────────────

export interface AddressFields {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/**
 * Format an address object into a single locale-aware string.
 *
 * en-US:  "123 Main St, Springfield, IL 62701, US"
 * es-ES:  "Calle Mayor 1, 28013 Madrid, Madrid, ES"
 */
export function formatAddress(addr: AddressFields): string {
  if (!addr) return '';
  const parts = isImperial()
    ? [addr.street, addr.city, addr.state, addr.postalCode, addr.country]
    : [addr.street, addr.postalCode, addr.city, addr.state, addr.country];

  return parts.filter(Boolean).join(', ');
}
