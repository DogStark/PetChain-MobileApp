/**
 * Spending summaries for categorized expenses over a selected period.
 *
 * Totals are kept per fiat currency and per native/token asset and are never
 * summed across assets, so a mixed-currency list cannot produce a misleading
 * single figure. Every total carries an explicit unit label. Amounts are
 * integer minor units, so no floating-point rounding can occur.
 *
 * Summaries only keep categories and totals: expense ids and descriptions are
 * dropped, so pet-level detail does not leave this module by default.
 */

import { formatCurrency, getCurrencyMeta, type CurrencyCode } from './formatCurrency';

export type SpendingAsset =
  | { kind: 'fiat'; code: CurrencyCode }
  | { kind: 'native' | 'token'; code: string; minorUnits: number };

export interface SpendingExpense {
  id: string;
  category: string;
  /** Integer amount in the asset's minor units (e.g. cents, stroops). */
  amountMinor: number;
  asset: SpendingAsset;
  /** ISO-8601 timestamp of when the expense was incurred. */
  incurredAt: string;
}

export interface SpendingPeriod {
  /** Inclusive start, in epoch milliseconds. */
  startMs: number;
  /** Exclusive end, in epoch milliseconds. */
  endMs: number;
}

export interface SpendingTotal {
  assetKey: string;
  /** Explicit unit label, e.g. "$12.34" or "1.2500000 XLM". */
  label: string;
  totalMinor: number;
  count: number;
}

export interface CategorySpending {
  category: string;
  totals: SpendingTotal[];
}

export interface SpendingSummary {
  totals: SpendingTotal[];
  categories: CategorySpending[];
  /** Expenses skipped because their amount, date, category or asset was invalid. */
  invalidCount: number;
}

interface Accumulator {
  asset: SpendingAsset;
  minorUnits: number;
  totalMinor: number;
  count: number;
}

function assetKey(asset: SpendingAsset): string {
  return `${asset.kind}:${asset.code}`;
}

/** Minor units per whole unit, or null when the asset metadata is invalid. */
function resolveMinorUnits(asset: SpendingAsset): number | null {
  if (asset.kind === 'fiat') {
    try {
      return getCurrencyMeta(asset.code).minorUnits;
    } catch {
      return null;
    }
  }
  return Number.isInteger(asset.minorUnits) && asset.minorUnits > 0 ? asset.minorUnits : null;
}

function formatAssetAmount(minor: number, asset: SpendingAsset, minorUnits: number): string {
  if (asset.kind === 'fiat') {
    return formatCurrency(minor, getCurrencyMeta(asset.code));
  }

  // Native/token amounts are rendered from integer digits, mirroring formatCurrency.
  const digits = String(minorUnits).length - 1;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / minorUnits);
  const fraction = digits > 0 ? `.${String(abs % minorUnits).padStart(digits, '0')}` : '';
  return `${minor < 0 ? '-' : ''}${whole}${fraction} ${asset.code}`;
}

/** True when adding the amount keeps the running total a safe integer. */
function canAdd(accumulators: Map<string, Accumulator>, key: string, amountMinor: number): boolean {
  const current = accumulators.get(key)?.totalMinor ?? 0;
  return Number.isSafeInteger(current + amountMinor);
}

function add(
  accumulators: Map<string, Accumulator>,
  asset: SpendingAsset,
  minorUnits: number,
  amountMinor: number,
): void {
  const key = assetKey(asset);
  const acc = accumulators.get(key) ?? { asset, minorUnits, totalMinor: 0, count: 0 };
  acc.totalMinor += amountMinor;
  acc.count += 1;
  accumulators.set(key, acc);
}

function finalize(accumulators: Map<string, Accumulator>): SpendingTotal[] {
  return [...accumulators.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, acc]) => ({
      assetKey: key,
      label: formatAssetAmount(acc.totalMinor, acc.asset, acc.minorUnits),
      totalMinor: acc.totalMinor,
      count: acc.count,
    }));
}

/**
 * Aggregate expenses incurred within the period, grouped by category and
 * kept separate per asset. Expenses outside the period are ignored; invalid
 * expenses are counted in `invalidCount` rather than silently dropped.
 *
 * @throws RangeError if the period is empty or inverted
 */
export function summarizeSpending(
  expenses: readonly SpendingExpense[],
  period: SpendingPeriod,
): SpendingSummary {
  if (!Number.isFinite(period.startMs) || !Number.isFinite(period.endMs) || period.startMs >= period.endMs) {
    throw new RangeError('summarizeSpending: period must have startMs < endMs');
  }

  const totals = new Map<string, Accumulator>();
  const byCategory = new Map<string, Map<string, Accumulator>>();
  let invalidCount = 0;

  for (const expense of expenses) {
    const category = expense.category.trim();
    const minorUnits = resolveMinorUnits(expense.asset);
    const incurredMs = Date.parse(expense.incurredAt);

    if (
      minorUnits === null ||
      !category ||
      !Number.isSafeInteger(expense.amountMinor) ||
      Number.isNaN(incurredMs)
    ) {
      invalidCount += 1;
      continue;
    }
    if (incurredMs < period.startMs || incurredMs >= period.endMs) {
      continue;
    }

    const key = assetKey(expense.asset);
    const categoryTotals = byCategory.get(category) ?? new Map<string, Accumulator>();
    if (!canAdd(totals, key, expense.amountMinor) || !canAdd(categoryTotals, key, expense.amountMinor)) {
      invalidCount += 1;
      continue;
    }

    add(totals, expense.asset, minorUnits, expense.amountMinor);
    add(categoryTotals, expense.asset, minorUnits, expense.amountMinor);
    byCategory.set(category, categoryTotals);
  }

  const categories = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, accumulators]) => ({ category, totals: finalize(accumulators) }));

  return { totals: finalize(totals), categories, invalidCount };
}
