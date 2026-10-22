/**
 * Pet Shortcut Service (#1191)
 *
 * Backs app shortcuts that switch the active pet:
 *  - Tracks recently activated pets (local only, most recent first, capped)
 *  - Builds shortcut entries from those pets with privacy-safe labels
 *    (pet name only: never microchip, owner, or internal IDs)
 *  - Confirms access against the server before a shortcut switches pets.
 *    403/404 are treated as denial and the pet is dropped from recents.
 *    Network failures fall back to the cached pet, matching petService's
 *    existing offline behavior.
 */

import { getPetById, PetServiceError, type Pet } from './petService';
import { getItem, setItem } from './localDB';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PetShortcutItem {
  /** Stable shortcut identifier for the native launcher */
  id: string;
  /** Label shown in the launcher. Pet name only, never identifiers. */
  title: string;
  petId: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RECENT_PET_IDS_KEY = '@recent_pet_ids';
export const MAX_RECENT_PET_SHORTCUTS = 4;

// ─── Recent pets ──────────────────────────────────────────────────────────────

export async function getRecentPetIds(): Promise<string[]> {
  try {
    const raw = await getItem(RECENT_PET_IDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

async function saveRecentPetIds(ids: string[]): Promise<void> {
  await setItem(RECENT_PET_IDS_KEY, JSON.stringify(ids.slice(0, MAX_RECENT_PET_SHORTCUTS)));
}

/** Move a pet to the front of the recent list. Never throws into UI code. */
export async function recordRecentPet(petId: string): Promise<void> {
  try {
    const current = await getRecentPetIds();
    await saveRecentPetIds([petId, ...current.filter((id) => id !== petId)]);
  } catch (error) {
    console.error('[PetShortcutService] Failed to record recent pet:', error);
  }
}

/** Remove a pet from the recent list, e.g. after access is denied. */
export async function forgetRecentPet(petId: string): Promise<void> {
  try {
    const current = await getRecentPetIds();
    await saveRecentPetIds(current.filter((id) => id !== petId));
  } catch (error) {
    console.error('[PetShortcutService] Failed to forget recent pet:', error);
  }
}

// ─── Shortcut items ───────────────────────────────────────────────────────────

/**
 * Build shortcut entries for recent pets that are still in the user's list.
 * Stale IDs (pets removed or no longer owned) are skipped.
 */
export function buildPetShortcutItems(pets: Pet[], recentPetIds: string[]): PetShortcutItem[] {
  const byId = new Map(pets.map((pet) => [pet.id, pet]));
  const items: PetShortcutItem[] = [];

  for (const petId of recentPetIds) {
    const pet = byId.get(petId);
    if (!pet) continue;
    items.push({ id: `switch-pet:${pet.id}`, title: pet.name, petId: pet.id });
    if (items.length === MAX_RECENT_PET_SHORTCUTS) break;
  }

  return items;
}

// ─── Launch-time validation ───────────────────────────────────────────────────

/**
 * Resolve a pet for a shortcut tap. Returns null when the pet should not be
 * activated, which keeps the current active pet unchanged.
 */
export async function resolveShortcutPet(petId: string): Promise<Pet | null> {
  try {
    return await getPetById(petId);
  } catch (error) {
    if (error instanceof PetServiceError && (error.status === 403 || error.status === 404)) {
      await forgetRecentPet(petId);
    }
    return null;
  }
}
