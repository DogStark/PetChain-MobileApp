/**
 * Deterministic, decimal-safe formatting for health costs and dosage units.
 *
 * Money is represented as integer minor units (e.g. cents) to avoid binary
 * floating-point rounding. Currency and unit metadata is explicit; nothing is
 * inferred from raw API values, and raw values are never mutated.
 */

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'JPY';

export interface CurrencyMeta {
  code: CurrencyCode;
  /** Number of minor units in one major unit (e.g. 100 for USD). */
  minorUnits: number;
  /** BCP-47 locale used for grouping and symbol placement. */
  locale: string;
}

export interface UnitMeta {
  code: string;
  /** Suffix appended to the formatted amount (e.g. "mg", "mL"). */
  suffix: string;
  /** Decimal places to render for this unit. */
  decimals: number;
}

const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  USD: { code: 'USD', minorUnits: 100, locale: 'en-US' },
  EUR: { code: 'EUR', minorUnits: 100, locale: 'de-DE' },
  GBP: { code: 'GBP', minorUnits: 100, locale: 'en-GB' },
  JPY: { code: 'JPY', minorUnits: 1, locale: 'ja-JP' },
};

const UNITS: Record<string, UnitMeta> = {
  mg: { code: 'mg', suffix: 'mg', decimals: 0 },
  mL: { code: 'mL', suffix: 'mL', decimals: 1 },
  tablet: { code: 'tablet', suffix: 'tablet', decimals: 0 },
};

/**
 * Split integer minor units into a sign, whole major units and the remaining
 * minor units, using only integer arithmetic (no floating point).
 */
function splitMinorUnits(minorUnits: number, minorPerMajor: number) {
  const negative = minorUnits < 0;
  const abs = Math.abs(minorUnits);
  const major = Math.floor(abs / minorPerMajor);
  const minor = abs % minorPerMajor;
  return { negative, major, minor };
}

/**
 * Format an integer amount of minor units as a localized currency string.
 *
 * @param minorUnits integer amount in the currency's minor unit (e.g. cents)
 * @param currency explicit currency metadata
 * @throws if the amount is not a safe integer or metadata is invalid
 */
export function formatCurrency(minorUnits: number, currency: CurrencyMeta): string {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new TypeError('formatCurrency: minorUnits must be a safe integer');
  }
  if (!currency || !Number.isInteger(currency.minorUnits) || currency.minorUnits <= 0) {
    throw new TypeError('formatCurrency: invalid currency metadata');
  }

  const { negative, major, minor } = splitMinorUnits(minorUnits, currency.minorUnits);
  const fractionDigits = String(currency.minorUnits).length - 1;
  const fraction = fractionDigits > 0 ? String(minor).padStart(fractionDigits, '0') : '';

  const formatter = new Intl.NumberFormat(currency.locale, {
    style: 'currency',
    currency: currency.code,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  // Format the integer major part, then append the exact minor digits so no
  // floating-point rounding can occur.
  const majorText = formatter.format(negative ? -major : major);
  if (fractionDigits === 0) {
    return majorText;
  }

  const decimalSeparator = getDecimalSeparator(currency.locale);
  return `${majorText}${decimalSeparator}${fraction}`;
}

/**
 * Format a dosage/quantity value with explicit unit metadata.
 *
 * @param value numeric quantity (already validated by the caller)
 * @param unit explicit unit metadata
 * @throws if the value is not finite or metadata is invalid
 */
export function formatUnit(value: number, unit: UnitMeta): string {
  if (!Number.isFinite(value)) {
    throw new TypeError('formatUnit: value must be a finite number');
  }
  if (!unit || !Number.isInteger(unit.decimals) || unit.decimals < 0) {
    throw new TypeError('formatUnit: invalid unit metadata');
  }

  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: unit.decimals,
    maximumFractionDigits: unit.decimals,
  });

  return `${formatter.format(value)} ${unit.suffix}`;
}

/** Look up explicit currency metadata by code, failing safely if unknown. */
export function getCurrencyMeta(code: string): CurrencyMeta {
  const meta = CURRENCIES[code as CurrencyCode];
  if (!meta) {
    throw new RangeError(`Unsupported currency: ${code}`);
  }
  return meta;
}

/** Look up explicit unit metadata by code, failing safely if unknown. */
export function getUnitMeta(code: string): UnitMeta {
  const meta = UNITS[code];
  if (!meta) {
    throw new RangeError(`Unsupported unit: ${code}`);
  }
  return meta;
}

function getDecimalSeparator(locale: string): string {
  const parts = new Intl.NumberFormat(locale).formatToParts(1.1);
  const decimal = parts.find((part) => part.type === 'decimal');
  return decimal ? decimal.value : '.';
}
