/**
 * petShortcutsService.ts
 *
 * Manages home-screen / launcher app shortcuts for switching active pets
 * (issue #1191).
 *
 * Responsibilities:
 *  - Maintain a bounded MRU (most-recently-used) list of active pets for OS
 *    quick actions / app shortcuts (`MAX_PET_SHORTCUTS = 4`).
 *  - Build privacy-safe shortcut items that never expose microchip IDs, Stellar
 *    wallet addresses, medical record numbers, owner emails, or raw database IDs
 *    in user-visible labels or screen-reader announcements.
 *  - Validate server-confirmed access on shortcut launch before switching the
 *    active pet, while preserving offline switching for cached pets owned by or
 *    shared with the signed-in user.
 *  - Evict revoked or deleted pets from the shortcut list and surface explicit
 *    `access_denied` and retryable `stale_access` outcomes.
 */

import type { Pet } from './petService';

export const MAX_PET_SHORTCUTS = 4;
export const PET_SHORTCUT_ACTION_TYPE = 'app.petchain.switch_pet';
const DEFAULT_PERMISSION_STALE_MS = 5 * 60 * 1000;

export interface RecentPetEntry {
  petId: string;
  name: string;
  species: Pet['species'];
  lastSelectedAt: number;
}

export interface PetAppShortcutItem {
  id: string;
  type: typeof PET_SHORTCUT_ACTION_TYPE;
  title: string;
  subtitle: string;
  accessibilityLabel: string;
  accessibilityHint: string;
  userInfo: {
    petId: string;
  };
}

export interface PetAccessConfirmation {
  petId: string;
  currentUserId: string;
  serverConfirmed: boolean;
  hasAccess: boolean;
  confirmedAt: number | null;
  staleAfterMs?: number;
  isOffline?: boolean;
  offlineCachedAccess?: boolean;
}

export interface ShortcutLaunchResult {
  allowed: boolean;
  status:
    | 'activated'
    | 'activated_offline'
    | 'access_denied'
    | 'stale_access'
    | 'pet_not_found'
    | 'invalid_payload';
  activePet: Pet | null;
  retryable: boolean;
  announcement: string;
  updatedRecentEntries: RecentPetEntry[];
}

const SENSITIVE_LABEL_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Stellar public keys (G... 56 chars)
  { pattern: /\bG[A-Z2-7]{55}\b/g, replacement: '' },
  // 15-digit ISO pet microchip IDs
  { pattern: /\b\d{15}\b/g, replacement: '' },
  // UUIDs
  {
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replacement: '',
  },
  // Emails
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '',
  },
  // Key-value sensitive tokens
  {
    pattern: /\b(?:microchip|chip|wallet|token|secret|recordId|ownerId)[:=]\s*[^\s,;)]+/gi,
    replacement: '',
  },
];

/**
 * Strips sensitive pet/owner identifiers from shortcut labels so launcher menus
 * and lock-screen quick actions never leak private identifiers.
 */
export function sanitizeShortcutLabel(rawName?: string | null): string {
  if (!rawName) return 'Pet';
  let cleaned = rawName;
  for (const { pattern, replacement } of SENSITIVE_LABEL_PATTERNS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  // Remove leftover empty parentheses/brackets and collapse whitespace
  cleaned = cleaned
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > 0 ? cleaned.slice(0, 32) : 'Pet';
}

function formatSpeciesSubtitle(species?: Pet['species']): string {
  switch (species) {
    case 'dog':
      return 'Switch to dog profile';
    case 'cat':
      return 'Switch to cat profile';
    case 'bird':
      return 'Switch to bird profile';
    case 'rabbit':
      return 'Switch to rabbit profile';
    default:
      return 'Switch active pet profile';
  }
}

/**
 * Records a pet selection in MRU order, deduplicating by `pet.id` and capping at
 * `MAX_PET_SHORTCUTS`. Ignores optimistic unconfirmed placeholders (`optimistic-*`).
 */
export function recordRecentPetSelection(
  existing: RecentPetEntry[],
  pet: Pick<Pet, 'id' | 'name' | 'species'>,
  now: number = Date.now(),
  maxShortcuts: number = MAX_PET_SHORTCUTS,
): RecentPetEntry[] {
  if (!pet?.id || pet.id.startsWith('optimistic-')) {
    return [...existing];
  }

  const safeLimit = Math.max(1, Math.min(maxShortcuts, MAX_PET_SHORTCUTS));
  const nextEntry: RecentPetEntry = {
    petId: pet.id,
    name: sanitizeShortcutLabel(pet.name),
    species: pet.species,
    lastSelectedAt: now,
  };

  const filtered = existing.filter((e) => e.petId !== pet.id);
  return [nextEntry, ...filtered].slice(0, safeLimit);
}

/**
 * Builds privacy-safe OS shortcut items from the MRU list, filtered to pets currently
 * present in `availablePets` so deleted pets are never exposed.
 */
export function buildPetAppShortcuts(
  recentEntries: RecentPetEntry[],
  availablePets?: Pet[],
): PetAppShortcutItem[] {
  const allowedIds = availablePets ? new Set(availablePets.map((p) => p.id)) : null;

  const sorted = [...recentEntries]
    .filter((entry) => Boolean(entry.petId) && (!allowedIds || allowedIds.has(entry.petId)))
    .sort((a, b) => b.lastSelectedAt - a.lastSelectedAt)
    .slice(0, MAX_PET_SHORTCUTS);

  return sorted.map((entry, index) => {
    const safeName = sanitizeShortcutLabel(entry.name);
    const subtitle = formatSpeciesSubtitle(entry.species);
    return {
      id: `pet-shortcut-${index + 1}`,
      type: PET_SHORTCUT_ACTION_TYPE,
      title: safeName,
      subtitle,
      accessibilityLabel: `Switch active pet to ${safeName}`,
      accessibilityHint: `${subtitle}. Verifies account access on launch.`,
      userInfo: {
        petId: entry.petId,
      },
    };
  });
}

/**
 * Validates and resolves an incoming app shortcut invocation on launch.
 * Enforces server-confirmed permissions when online, preserves cached access when
 * offline, and evicts unauthorized/deleted pets from `recentEntries`.
 */
export function resolvePetShortcutLaunch(options: {
  shortcutPayload?: { type?: string; userInfo?: { petId?: string } } | null;
  pets: Pet[];
  recentEntries: RecentPetEntry[];
  fallbackActivePet?: Pet | null;
  accessConfirmation?: PetAccessConfirmation;
  now?: number;
}): ShortcutLaunchResult {
  const {
    shortcutPayload,
    pets,
    recentEntries,
    fallbackActivePet = null,
    accessConfirmation,
    now = Date.now(),
  } = options;

  const requestedPetId = shortcutPayload?.userInfo?.petId?.trim();
  if (
    !shortcutPayload ||
    shortcutPayload.type !== PET_SHORTCUT_ACTION_TYPE ||
    !requestedPetId
  ) {
    return {
      allowed: false,
      status: 'invalid_payload',
      activePet: fallbackActivePet,
      retryable: false,
      announcement: 'Unable to switch pet: invalid shortcut.',
      updatedRecentEntries: [...recentEntries],
    };
  }

  const targetPet = pets.find((p) => p.id === requestedPetId);
  if (!targetPet) {
    const pruned = recentEntries.filter((e) => e.petId !== requestedPetId);
    return {
      allowed: false,
      status: 'pet_not_found',
      activePet: fallbackActivePet,
      retryable: false,
      announcement: 'Selected pet profile is no longer available.',
      updatedRecentEntries: pruned,
    };
  }

  if (accessConfirmation) {
    if (accessConfirmation.petId !== requestedPetId) {
      return {
        allowed: false,
        status: 'access_denied',
        activePet: fallbackActivePet,
        retryable: false,
        announcement: 'Access to the requested pet profile could not be verified.',
        updatedRecentEntries: recentEntries.filter((e) => e.petId !== requestedPetId),
      };
    }

    const ownerMatches =
      !targetPet.ownerId || targetPet.ownerId === accessConfirmation.currentUserId;

    if (accessConfirmation.isOffline) {
      if (accessConfirmation.offlineCachedAccess && ownerMatches) {
        const safeName = sanitizeShortcutLabel(targetPet.name);
        const updated = recordRecentPetSelection(recentEntries, targetPet, now);
        return {
          allowed: true,
          status: 'activated_offline',
          activePet: targetPet,
          retryable: false,
          announcement: `Offline mode: active pet switched to ${safeName}.`,
          updatedRecentEntries: updated,
        };
      }

      const pruned = recentEntries.filter((e) => e.petId !== requestedPetId);
      return {
        allowed: false,
        status: 'access_denied',
        activePet: fallbackActivePet,
        retryable: false,
        announcement: 'Cannot switch pet while offline without cached access permission.',
        updatedRecentEntries: pruned,
      };
    }

    if (!accessConfirmation.serverConfirmed || !accessConfirmation.hasAccess || !ownerMatches) {
      const pruned = recentEntries.filter((e) => e.petId !== requestedPetId);
      return {
        allowed: false,
        status: 'access_denied',
        activePet: fallbackActivePet,
        retryable: false,
        announcement: 'Access to this pet profile was denied.',
        updatedRecentEntries: pruned,
      };
    }

    const staleWindow = accessConfirmation.staleAfterMs ?? DEFAULT_PERMISSION_STALE_MS;
    if (
      accessConfirmation.confirmedAt === null ||
      now - accessConfirmation.confirmedAt > staleWindow
    ) {
      return {
        allowed: false,
        status: 'stale_access',
        activePet: fallbackActivePet,
        retryable: true,
        announcement: 'Pet access confirmation is out of date. Refreshing permissions.',
        updatedRecentEntries: [...recentEntries],
      };
    }
  }

  const safeName = sanitizeShortcutLabel(targetPet.name);
  const updated = recordRecentPetSelection(recentEntries, targetPet, now);
  return {
    allowed: true,
    status: 'activated',
    activePet: targetPet,
    retryable: false,
    announcement: `Active pet switched to ${safeName}.`,
    updatedRecentEntries: updated,
  };
}
