export interface PrescriberInfo {
  name?: string;
  contact?: string;
  clinic?: string;
}

export interface PharmacyInfo {
  name?: string;
  phone?: string;
  address?: string;
}

export type MedicationStatus = 'active' | 'paused' | 'completed' | 'discontinued';

/**
 * Refill status derived from current supply and dosage schedule.
 * - 'ok'       : supply will last > 7 days
 * - 'warning'  : supply will run out in 4-7 days (7-day reminder window)
 * - 'urgent'   : supply will run out within 3 days (3-day reminder window)
 * - 'out'      : no supply remaining
 * - 'unknown'  : supply information not provided
 */
export type RefillStatus = 'ok' | 'warning' | 'urgent' | 'out' | 'unknown';

export interface Medication {
  id: string;
  petId: string;
  name: string;
  dosage: string;
  frequency: number; // hours between doses
  startDate: string; // ISO date string
  endDate?: string; // ISO date string
  instructions?: string;
  prescriberInfo?: PrescriberInfo;
  pharmacyInfo?: PharmacyInfo;
  totalPills?: number;
  remainingPills?: number;
  refillDate?: string;
  status?: MedicationStatus;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;

  // ── Refill tracking fields ──────────────────────────────────────────────────
  /** Current number of doses/pills on hand (writable; decremented each dose). */
  currentSupply?: number;
  /** How many doses are taken per day based on the frequency schedule. */
  dosesPerDay?: number;
  /** ISO date string of the most-recent refill (used to calculate next run-out). */
  lastRefillDate?: string;
  /**
   * Estimated date the supply will run out, as an ISO date string.
   * Derived from currentSupply, dosesPerDay, and the current date.
   * Persisted so the value survives restarts without re-calculation.
   */
  estimatedRunOutDate?: string;
  /** IDs of the scheduled refill-reminder push notifications for this medication. */
  refillNotificationIds?: string[];

  // ── Vet approval tracking ────────────────────────────────────────────────────
  /** Indicates if this dosage is pending vet approval. */
  pendingApproval?: boolean;
  /** ID of the associated dosage approval request. */
  approvalRequestId?: string;
  /** Vet ID who will review the dosage. */
  reviewingVetId?: string;
}

export interface CreateMedicationInput extends Omit<Medication, 'id' | 'createdAt' | 'updatedAt'> {
  status?: MedicationStatus;
}

export type UpdateMedicationInput = Partial<
  Omit<Medication, 'id' | 'petId' | 'createdAt' | 'updatedAt'>
>;
