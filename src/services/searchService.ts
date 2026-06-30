import apiClient from './apiClient';
import { logError } from '../utils/errorLogger';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export type SearchCategory = 'pets' | 'medical_records' | 'appointments' | 'all';

export interface SearchResultItem {
  id: string;
  category: SearchCategory;
  title: string;
  subtitle?: string;
  /** ISO 8601 date string — used for sorting */
  date?: string;
  /** Extra data the UI may need (e.g. petId for navigation) */
  meta?: Record<string, unknown>;
}

export interface SearchResults {
  query: string;
  total: number;
  items: SearchResultItem[];
  /** True when results were served from the local cache */
  fromCache: boolean;
}

// ─────────────────────────────────────────────────────────────
// LOCAL SEARCH HELPERS
// (fall-through when offline or for instant local results)
// ─────────────────────────────────────────────────────────────

function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

// ─────────────────────────────────────────────────────────────
// SEARCH SERVICE
// ─────────────────────────────────────────────────────────────

const DEBOUNCE_DELAY_MS = 300;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Global search across pets, medical records, and appointments.
 *
 * Strategy:
 *  1. Instantly return local results (if localData provided) for zero-latency feedback.
 *  2. In parallel, fetch remote results and merge/deduplicate.
 */
export async function globalSearch(
  query: string,
  category: SearchCategory = 'all',
  localData?: {
    pets?: { id: string; name: string; species: string; breed?: string }[];
    appointments?: {
      id: string;
      title?: string;
      petName?: string;
      date?: string;
      status?: string;
    }[];
    medicalRecords?: {
      id: string;
      title?: string;
      petName?: string;
      date?: string;
      type?: string;
    }[];
  },
  signal?: AbortSignal
): Promise<SearchResults> {
  if (!query.trim()) {
    return { query, total: 0, items: [], fromCache: false };
  }

  try {
    // Remote search — backend returns unified results
    const response = await apiClient.get<{ items: SearchResultItem[]; total: number }>('/search', {
      params: { q: query, category },
      signal,
    });
    return { query, total: response.data.total, items: response.data.items, fromCache: false };
  } catch (error: any) {
    if (error.name === 'CanceledError' || error.name === 'AbortError') {
      throw error;
    }
    // Offline fallback: search locally provided data
    if (!localData) return { query, total: 0, items: [], fromCache: true };

    const items: SearchResultItem[] = [];

    if ((category === 'all' || category === 'pets') && localData.pets) {
      for (const pet of localData.pets) {
        if (
          matchesQuery(pet.name, query) ||
          matchesQuery(pet.species, query) ||
          (pet.breed && matchesQuery(pet.breed, query))
        ) {
          items.push({
            id: pet.id,
            category: 'pets',
            title: pet.name,
            subtitle: [pet.species, pet.breed].filter(Boolean).join(' · '),
          });
        }
      }
    }

    if ((category === 'all' || category === 'appointments') && localData.appointments) {
      for (const appt of localData.appointments) {
        if (
          (appt.title && matchesQuery(appt.title, query)) ||
          (appt.petName && matchesQuery(appt.petName, query)) ||
          (appt.status && matchesQuery(appt.status, query))
        ) {
          items.push({
            id: appt.id,
            category: 'appointments',
            title: appt.title ?? 'Appointment',
            subtitle: appt.petName,
            date: appt.date,
          });
        }
      }
    }

    if ((category === 'all' || category === 'medical_records') && localData.medicalRecords) {
      for (const rec of localData.medicalRecords) {
        if (
          (rec.title && matchesQuery(rec.title, query)) ||
          (rec.petName && matchesQuery(rec.petName, query)) ||
          (rec.type && matchesQuery(rec.type, query))
        ) {
          items.push({
            id: rec.id,
            category: 'medical_records',
            title: rec.title ?? 'Medical Record',
            subtitle: rec.petName,
            date: rec.date,
          });
        }
      }
    }

    return { query, total: items.length, items, fromCache: true };
  }
}

/**
 * Debounced wrapper for use in search input onChange handlers.
 * Returns a cancel function.
 */
export function debouncedSearch(
  query: string,
  category: SearchCategory,
  onResults: (results: SearchResults) => void,
  localData?: Parameters<typeof globalSearch>[2],
): () => void {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(async () => {
    try {
      const results = await globalSearch(query, category, localData);
      onResults(results);
    } catch (err) {
      logError(err as Error, { context: 'debouncedSearch' });
    }
  }, DEBOUNCE_DELAY_MS);

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}
