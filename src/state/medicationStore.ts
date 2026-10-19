import { create } from 'zustand';

export interface MedicationDose {
  id: string;
  medicationId: string;
  medicationName: string;
  /** ISO date (YYYY-MM-DD) the dose is scheduled for. */
  date: string;
  /** Start time in minutes from midnight (0-1439). */
  startMinutes: number;
  /** Duration in minutes; defaults to a single point when omitted. */
  durationMinutes?: number;
}

export interface ScheduleConflict {
  medicationId: string;
  medicationName: string;
  existingDoseId: string;
  incomingDoseId: string;
  reason: 'overlap' | 'duplicate-time';
}

export interface MedicationState {
  doses: MedicationDose[];
  pendingDose: MedicationDose | null;
  pendingConflicts: ScheduleConflict[];
  /**
   * Attempt to add a dose. If it conflicts with an existing dose for the same
   * medication, the dose is held as pending and conflicts are surfaced so the
   * UI can require explicit confirmation before persisting.
   * Returns true when the dose was persisted immediately (no conflict).
   */
  addDose: (dose: MedicationDose) => boolean;
  /** Persist the pending dose after the user confirms the conflict warning. */
  confirmPendingDose: () => void;
  /** Discard the pending dose (user declined the conflict warning). */
  cancelPendingDose: () => void;
  clearDoses: () => void;
}

const doseEnd = (dose: MedicationDose): number =>
  dose.startMinutes + Math.max(dose.durationMinutes ?? 0, 0);

/**
 * Pure conflict detection over already-entered data. No network access is
 * required, so offline behavior is preserved.
 */
export const findScheduleConflicts = (
  existing: MedicationDose[],
  incoming: MedicationDose,
): ScheduleConflict[] => {
  const conflicts: ScheduleConflict[] = [];
  for (const dose of existing) {
    if (dose.medicationId !== incoming.medicationId) continue;
    if (dose.date !== incoming.date) continue;

    const duplicateTime = dose.startMinutes === incoming.startMinutes;
    const overlaps =
      incoming.startMinutes < doseEnd(dose) &&
      dose.startMinutes < doseEnd(incoming);

    if (duplicateTime || overlaps) {
      conflicts.push({
        medicationId: incoming.medicationId,
        medicationName: incoming.medicationName,
        existingDoseId: dose.id,
        incomingDoseId: incoming.id,
        reason: duplicateTime ? 'duplicate-time' : 'overlap',
      });
    }
  }
  return conflicts;
};

export const useMedicationStore = create<MedicationState>((set, get) => ({
  doses: [],
  pendingDose: null,
  pendingConflicts: [],

  addDose: (dose) => {
    const conflicts = findScheduleConflicts(get().doses, dose);
    if (conflicts.length > 0) {
      set({ pendingDose: dose, pendingConflicts: conflicts });
      return false;
    }
    set((state) => ({ doses: [...state.doses, dose] }));
    return true;
  },

  confirmPendingDose: () => {
    const { pendingDose } = get();
    if (!pendingDose) return;
    set((state) => ({
      doses: [...state.doses, pendingDose],
      pendingDose: null,
      pendingConflicts: [],
    }));
  },

  cancelPendingDose: () => set({ pendingDose: null, pendingConflicts: [] }),

  clearDoses: () => set({ doses: [], pendingDose: null, pendingConflicts: [] }),
}));
