/**
 * Medication refill tracking and low-supply alert utilities.
 *
 * Supply is tracked in integer "milli-units" (1 unit = 1000 milli-units) so that
 * partial doses and fractional quantities are handled without floating-point drift.
 * All arithmetic is done on integers and only converted back to display units at
 * the very end.
 */

export const MILLI = 1000;

export type MedicationUnit =
  | 'tablet'
  | 'capsule'
  | 'ml'
  | 'mg'
  | 'drop'
  | 'patch'
  | 'puff';

export const SAFE_UNITS: readonly MedicationUnit[] = [
  'tablet',
  'capsule',
  'ml',
  'mg',
  'drop',
  'patch',
  'puff',
];

/** Units that may be split into partial doses. */
const SPLITTABLE_UNITS: readonly MedicationUnit[] = ['tablet', 'capsule', 'patch'];

/**
 * Pharmacy instructions attached to a prescription. Kept as free text but
 * validated for length so it can be safely stored and displayed.
 */
export interface PharmacyInstructions {
  /** e.g. "Take with food" */
  notes?: string;
  /** e.g. "Do not crush" */
  warnings?: string;
  /** e.g. "CVS #1234" */
  pharmacyName?: string;
  /** e.g. "(555) 123-4567" */
  pharmacyPhone?: string;
}

/** A single scheduled dose for a medication. */
export interface DoseSchedule {
  /** Amount taken per dose, in display units (may be fractional, e.g. 0.5). */
  amountPerDose: number;
  /** How many doses are taken per day. */
  dosesPerDay: number;
}

/** A recorded dose event used to reconcile supply. */
export interface DoseEvent {
  /** ISO timestamp of when the dose was scheduled. */
  scheduledAt: string;
  /** Amount actually taken, in display units. 0 means the dose was skipped. */
  amountTaken: number;
  /** True when the dose was intentionally skipped. */
  skipped?: boolean;
}

/** A refill event that adds supply back to the prescription. */
export interface RefillEvent {
  /** ISO timestamp of the refill. */
  filledAt: string;
  /** Quantity added by this refill, in display units. */
  quantity: number;
}

/** Low-supply alert configuration. */

export interface LowSupplyAlertConfig {
  /** Whether low-supply alerts are enabled for this medication. */
  enabled: boolean;
  /** Alert when remaining supply (in days) drops to or below this value. */
  thresholdDays: number;
  /** IANA timezone used to compute "days remaining" (e.g. "America/New_York"). */
  timezone: string;
}

export interface MedicationSupplyInput {
  /** Total quantity currently on hand, in display units. */
  quantity: number;
  /** Unit for quantity and dose amounts. */
  unit: MedicationUnit;
  /** Number of refills remaining on the prescription. */
  refillCount: number;
  /** Pharmacy instructions. */
  pharmacyInstructions?: PharmacyInstructions;
  /** Dose schedule. */
  schedule: DoseSchedule;
  /** Recorded dose events (taken, partial, or skipped). */
  doseEvents?: DoseEvent[];
  /** Refill events that added supply. */
  refillEvents?: RefillEvent[];
  /** Alert configuration. */
  alert?: LowSupplyAlertConfig;
  /** When true, the medication is discontinued and alerts must stop. */
  discontinued?: boolean;
}

/** Convert display units to integer milli-units without float drift. */
export function toMilli(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new Error('Amount must be a finite number');
  }
  // Round to the nearest milli-unit to absorb binary float representation error.
  return Math.round(amount * MILLI);
}

/** Convert integer milli-units back to display units. */
export function fromMilli(milli: number): number {
  return milli / MILLI;
}

/** Validate that a unit is one of the supported safe units. */
export function isSafeUnit(unit: string): unit is MedicationUnit {
  return (SAFE_UNITS as readonly string[]).includes(unit);
}

/**
 * Validate a partial dose amount for a given unit. Non-splittable units must be
 * whole numbers; splittable units may be fractional but must be positive.
 */
export function isValidDoseAmount(amount: number, unit: MedicationUnit): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (!SPLITTABLE_UNITS.includes(unit)) {
    return Number.isInteger(amount);
  }
  return true;
}

/**
 * Compute remaining supply in milli-units.
 *
 * Starts from the current quantity, adds refills, and subtracts only the amount
 * actually taken for each dose event. Skipped doses (amountTaken === 0 or
 * skipped === true) do not reduce supply, which correctly handles missed doses.
 */
export function computeRemainingMilli(input: MedicationSupplyInput): number {
  let remaining = toMilli(input.quantity);

  for (const refill of input.refillEvents ?? []) {
    remaining += toMilli(refill.quantity);
  }

  for (const dose of input.doseEvents ?? []) {
    if (dose.skipped) continue;
    const taken = dose.amountTaken;
    if (!Number.isFinite(taken) || taken <= 0) continue;
    remaining -= toMilli(taken);
  }

  return Math.max(0, remaining);
}

/** Remaining supply in display units. */
export function computeRemainingSupply(input: MedicationSupplyInput): number {
  return fromMilli(computeRemainingMilli(input));
}

/**
 * Compute the local calendar date (YYYY-MM-DD) for an instant in a timezone.
 * Uses Intl so it is timezone-safe across DST transitions.
 */
export function localDateKey(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${iso}`);
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Estimate how many days of supply remain based on the daily dose amount.
 * Returns Infinity when there is no daily consumption.
 */
export function daysRemaining(input: MedicationSupplyInput): number {
  const remainingMilli = computeRemainingMilli(input);
  const dailyMilli = toMilli(input.schedule.amountPerDose) * input.schedule.dosesPerDay;
  if (dailyMilli <= 0) return Number.POSITIVE_INFINITY;
  return remainingMilli / dailyMilli;
}

/**
 * Determine whether a low-supply alert should fire. Alerts are disabled when the
 * medication is discontinued, when alerts are turned off, or when supply is
 * above the configured threshold.
 */
export function shouldAlertLowSupply(input: MedicationSupplyInput): boolean {
  if (input.discontinued) return false;
  const alert = input.alert;
  if (!alert || !alert.enabled) return false;
  if (!Number.isFinite(alert.thresholdDays) || alert.thresholdDays < 0) return false;
  return daysRemaining(input) <= alert.thresholdDays;
}

/**
 * Compute the projected refill date (ISO string) given the current instant and
 * the configured timezone. Returns null when there is no finite supply horizon.
 */
export function projectedRefillDate(
  input: MedicationSupplyInput,
  nowIso: string,
): string | null {
  const days = daysRemaining(input);
  if (!Number.isFinite(days)) return null;
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid date: ${nowIso}`);
  }
  const refillAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return refillAt.toISOString();
}
