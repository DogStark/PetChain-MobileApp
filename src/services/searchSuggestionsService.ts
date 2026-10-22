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
