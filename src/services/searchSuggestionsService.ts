import AsyncStorage from '@react-native-async-storage/async-storage';

const RECENT_KEY = '@search_recent';
const MAX_RECENT = 10;

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  /** Navigation target or action identifier */
  action: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'add_pet', label: 'Add a pet', icon: '🐾', action: 'PetForm' },
  { id: 'book_appt', label: 'Book appointment', icon: '📅', action: 'Appointment' },
  { id: 'view_meds', label: 'View medications', icon: '💊', action: 'Medication' },
  { id: 'scan_qr', label: 'Scan QR code', icon: '📷', action: 'QRScanner' },
  { id: 'emergency', label: 'Emergency contacts', icon: '🆘', action: 'EmergencyContacts' },
];

export async function getRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function addRecentSearch(query: string): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) return;
  try {
    const current = await getRecentSearches();
    const deduped = [trimmed, ...current.filter((q) => q !== trimmed)].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(deduped));
  } catch {
    // non-critical
  }
}

export async function removeRecentSearch(query: string): Promise<string[]> {
  try {
    const current = await getRecentSearches();
    const updated = current.filter((q) => q !== query);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RECENT_KEY);
  } catch {
    // non-critical
  }
}

/** Filter recent searches by current input prefix (for inline autocomplete). */
export function filterSuggestions(recents: string[], query: string): string[] {
  if (!query.trim()) return recents;
  const q = query.toLowerCase();
  return recents.filter((r) => r.toLowerCase().startsWith(q));
}

// ─── Entity type-ahead suggestions (#1389) ────────────────────────────────────

export type SuggestionEntityType = 'pet' | 'vet' | 'medication' | 'appointment';

export interface EntitySuggestion {
  type: SuggestionEntityType;
  id: string;
  title: string;
  subtitle?: string;
  /** Extra navigation params (e.g. petId for a medication). */
  params?: Record<string, string>;
}

export interface SuggestionGroup {
  type: SuggestionEntityType;
  label: string;
  icon: string;
  items: EntitySuggestion[];
}

const ENTITY_INDEX_KEY = '@search_entity_index';
const MAX_PER_GROUP = 5;

/** Display order, labels and icons for suggestion groups. */
export const SUGGESTION_GROUPS: { type: SuggestionEntityType; label: string; icon: string }[] = [
  { type: 'pet', label: 'Pets', icon: '🐾' },
  { type: 'vet', label: 'Vets', icon: '🩺' },
  { type: 'medication', label: 'Medications', icon: '💊' },
  { type: 'appointment', label: 'Appointments', icon: '📅' },
];

/** Debounce applied before computing type-ahead suggestions. */
export const SUGGESTION_DEBOUNCE_MS = 300;

/** Reads the locally cached entity index (used offline). */
export async function getEntityIndex(): Promise<EntitySuggestion[]> {
  try {
    const raw = await AsyncStorage.getItem(ENTITY_INDEX_KEY);
    return raw ? (JSON.parse(raw) as EntitySuggestion[]) : [];
  } catch {
    return [];
  }
}

/** Loaders for each entity type; each should fall back to its local cache. */
export type EntityLoaders = Partial<Record<SuggestionEntityType, () => Promise<EntitySuggestion[]>>>;

/**
 * Refreshes the local entity index from the given loaders. Types whose loader
 * fails keep their previously cached entries, so suggestions keep working
 * offline.
 */
export async function refreshEntityIndex(loaders: EntityLoaders): Promise<EntitySuggestion[]> {
  const previous = await getEntityIndex();
  const types = Object.keys(loaders) as SuggestionEntityType[];
  const results = await Promise.allSettled(types.map((type) => loaders[type]!()));

  const fresh = new Map<SuggestionEntityType, EntitySuggestion[]>();
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') fresh.set(types[i], result.value);
  });

  const index = [
    ...previous.filter((s) => !fresh.has(s.type)),
    ...[...fresh.values()].flat(),
  ];
  try {
    await AsyncStorage.setItem(ENTITY_INDEX_KEY, JSON.stringify(index));
  } catch {
    // non-critical
  }
  return index;
}

/**
 * Type-ahead matches from the entity index, grouped by type in display order.
 * Matches on title or subtitle (case-insensitive), prefix matches first.
 */
export function getGroupedSuggestions(
  index: EntitySuggestion[],
  query: string,
): SuggestionGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const score = (s: EntitySuggestion): number => {
    const title = s.title.toLowerCase();
    if (title.startsWith(q)) return 0;
    if (title.includes(q)) return 1;
    return s.subtitle?.toLowerCase().includes(q) ? 2 : -1;
  };

  return SUGGESTION_GROUPS.map(({ type, label, icon }) => ({
    type,
    label,
    icon,
    items: index
      .filter((s) => s.type === type)
      .map((s) => ({ s, rank: score(s) }))
      .filter(({ rank }) => rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.s.title.localeCompare(b.s.title))
      .slice(0, MAX_PER_GROUP)
      .map(({ s }) => s),
  })).filter((group) => group.items.length > 0);
}

/** Navigation target for a suggestion. */
export function getSuggestionRoute(s: EntitySuggestion): {
  screen: string;
  params?: Record<string, unknown>;
} {
  switch (s.type) {
    case 'pet':
      return { screen: 'PetList', params: { screen: 'PetDetail', params: { petId: s.id } } };
    case 'medication':
      return { screen: 'Medications', params: { medicationId: s.id } };
    case 'appointment':
      return { screen: 'Appointments', params: { appointmentId: s.id } };
    case 'vet':
      return { screen: 'Appointments', params: { initialVetId: s.id, initialVetName: s.title } };
  }
}
