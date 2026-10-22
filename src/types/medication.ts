export type MedicationUnit = 'mg' | 'ml' | 'tablet' | 'capsule' | 'drop' | 'unit';

export interface PharmacyInstructions {
  /** Free-form directions from the pharmacy label. */
  directions?: string;
  /** Optional pharmacy phone number for refill requests. */
  phone?: string;
  /** Optional pharmacy name. */
  name?: string;
  /** Whether the prescription may be refilled automatically. */
  autoRefill?: boolean;
}

export interface MedicationRefill {
  /** Number of units added to supply by this refill. */
  quantity: number;
  /** ISO timestamp when the refill was recorded. */
  recordedAt: string;
  /** Optional refill number from the pharmacy label. */
  refillNumber?: number;
}

export interface MedicationDoseLog {
  /** ISO timestamp of the scheduled dose. */
  scheduledAt: string;
  /** ISO timestamp when the dose was actually taken, if it was. */
  takenAt?: string;
  /** Units consumed by this dose. Defaults to the medication dose. */
  amount?: number;
  /** True when the dose was intentionally skipped. */
  skipped?: boolean;
}

export interface LowSupplyAlertConfig {
  /** Whether low-supply alerts are enabled for this medication. */
  enabled: boolean;
  /** Alert when remaining supply is at or below this many units. */
  threshold: number;
  /** IANA timezone used to evaluate alert timing. */
  timezone: string;
  /** Optional local time of day (HH:mm) when alerts may fire. */
  timeOfDay?: string;
}

export interface Medication {
  id: string;
  name: string;
  /** Dose amount per administration, in `unit`. */
  dose: number;
  /** Safe unit for dose and supply quantities. */
  unit: MedicationUnit;
  /** Total quantity currently on hand, in `unit`. */
  quantity: number;
  /** Number of refills remaining on the prescription. */
  refillCount: number;
  /** Pharmacy instructions and contact details. */
  pharmacy?: PharmacyInstructions;
  /** History of refills that increased supply. */
  refills?: MedicationRefill[];
  /** History of scheduled/taken/skipped doses. */
  doseLogs?: MedicationDoseLog[];
  /** Low-supply alert configuration. */
  lowSupplyAlert?: LowSupplyAlertConfig;
  /** ISO timestamp when the medication was discontinued, if applicable. */
  discontinuedAt?: string;
}
