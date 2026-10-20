/**
 * Dose Shortcut Service (#1185)
 *
 * Backs the "log a dose" quick action. A shortcut opens a confirmation screen
 * bound to one pet and one medicine:
 *  - The pet is confirmed with the server via {@link resolveShortcutPet}, so a
 *    revoked or deleted pet is never shown. Denied or stale targets resolve to
 *    null and the screen shows an unavailable state.
 *  - The medicine must still exist and belong to that pet. A medicine moved to
 *    another pet, or deleted locally, is treated as stale.
 *  - Nothing is written until the user confirms. Logging goes through
 *    {@link transitionDose}, which is local-only, so it keeps working offline.
 */

import { resolveShortcutPet } from './petShortcutService';
import { getMedications, transitionDose } from './medicationService';
import type { Pet } from './petService';
import type { Medication } from '../models/Medication';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DoseShortcutTarget {
  pet: Pet;
  medication: Medication;
}

// ─── Target resolution ────────────────────────────────────────────────────────

/**
 * Resolve the pet and medicine for a dose shortcut. Returns null when the pet
 * is denied or unavailable, or when the medicine no longer belongs to the pet.
 */
export async function resolveDoseShortcut(
  petId: string,
  medicationId: string,
): Promise<DoseShortcutTarget | null> {
  const pet = await resolveShortcutPet(petId);
  if (!pet) return null;

  const medication = (await getMedications()).find(
    (med) => med.id === medicationId && med.petId === pet.id,
  );
  if (!medication) return null;

  return { pet, medication };
}

// ─── Confirmation ─────────────────────────────────────────────────────────────

/**
 * Log the confirmed dose as taken now. Only call after explicit user
 * confirmation. Repeated calls for the same scheduled minute return the
 * existing record with `duplicate: true` instead of a second entry.
 */
export async function confirmShortcutDose(
  medication: Medication,
  now: Date = new Date(),
): Promise<{ duplicate: boolean }> {
  const result = await transitionDose(medication.id, now, 'taken', { now });
  return { duplicate: result.duplicate };
}
