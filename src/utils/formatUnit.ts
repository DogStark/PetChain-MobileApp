/**
 * Deterministic, decimal-safe formatting for health costs and dosage units.
 *
 * Money is represented in integer minor units (e.g. cents) to avoid binary
 * floating-point rounding. Currency and unit metadata is explicit; nothing is
 * inferred from raw values. Invalid metadata fails safely by returning null.
 */

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'JPY';

export interface CurrencyMeta {
  code: CurrencyCode;
  /** Number of minor units in one major unit (e.g. 100 for USD). */
  minorUnits: number;
  /** BCP 47 locale used for grouping and symbol placement. */
  locale: string;
}

export interface UnitMeta {
  code: string;
  /** Decimal places to render for this unit. */
  precision: number;
  /** Optional suffix appended after the value (e.g. "mg"). */
  suffix?: string;
}

const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  USD: { code: 'USD', minorUnits: 100, locale: 'en-US' },
  EUR: { code: 'EUR', minorUnits: 100, locale: 'de-DE' },
  GBP: { code: 'GBP', minorUnits: 100, locale: 'en-GB' },
  JPY: { code: 'JPY', minorUnits: 1, locale: 'ja-JP' },
};

const UNITS: Record<string, UnitMeta> = {
  mg: { code: 'mg', precision: 0, suffix: 'mg' },
  ml: { code: 'ml', precision: 1, suffix: 'mL' },
  tablet: { code: 'tablet', precision: 0, suffix: 'tab' },
};

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * Format an integer amount of minor units as a localized currency string.
 * Returns null when the currency code or amount is invalid.
 */
export function formatCurrency(
  minorAmount: number,
  currency: CurrencyCode,
): string | null {
  const meta = CURRENCIES[currency];
  if (!meta || !isSafeInteger(minorAmount)) {
    return null;
  }

  const major = minorAmount / meta.minorUnits;
  const fractionDigits = meta.minorUnits === 1 ? 0 : 2;

  try {
    return new Intl.NumberFormat(meta.locale, {
      style: 'currency',
      currency: meta.code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(major);
  } catch {
    return null;
  }
}

/**
 * Format a dosage/quantity value with explicit unit metadata.
 * Returns null when the unit code or value is invalid.
 */
export function formatUnit(value: number, unitCode: string): string | null {
  const meta = UNITS[unitCode];
  if (!meta || typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Number(value.toFixed(meta.precision));
  const formatted = rounded.toFixed(meta.precision);
  return meta.suffix ? `${formatted} ${meta.suffix}` : formatted;
}

/**
 * Parse a decimal string into integer minor units without binary rounding.
 * Returns null when the input or currency metadata is invalid.
 */
export function toMinorUnits(
  decimal: string,
  currency: CurrencyCode,
): number | null {
  const meta = CURRENCIES[currency];
  if (!meta || typeof decimal !== 'string') {
    return null;
  }

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!match) {
    return null;
  }

  const [, sign, whole, fraction = ''] = match;
  const digits = meta.minorUnits === 1 ? 0 : String(meta.minorUnits).length - 1;
  const padded = (fraction + '0'.repeat(digits)).slice(0, digits);
  const minor = Number(whole) * meta.minorUnits + Number(padded || '0');

  if (!Number.isSafeInteger(minor)) {
    return null;
  }
  return sign === '-' ? -minor : minor;
}
