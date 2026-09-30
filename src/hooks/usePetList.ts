import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Species } from '../models/Pet';
import { getAllPets, type Pet } from '../services/petService';

/** Options accepted by usePetList */
export interface UsePetListOptions {
  /** Filter by species */
  species?: Species;
  /** Full‑text search across name and breed */
  search?: string;
  /** Number of pets per page (default 10) */
  pageSize?: number;
}

/** Return type for the usePetList hook */
export interface UsePetListReturn {
  /** The current page of filtered pets */
  pets: Pet[];
  /** True during the initial fetch or a refetch */
  isLoading: boolean;
  /** The most recent error message, or null */
  error: string | null;
  /** Load the next page of results (no‑op when hasMore is false) */
  fetchMore: () => void;
  /** Re‑fetch all pets from the backend */
  refetch: () => Promise<void>;
  /** True when more pages are available */
  hasMore: boolean;
  /** Total number of pets matching the current filters */
  total: number;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * usePetList
 *
 * React hook that fetches, filters, paginates, and caches a list of pets
 * for the current user.
 *
 * - The full list is fetched once via {@link getAllPets} (which itself hits
 *   the API and falls back to local cache).
 * - Filters (species / search) and pagination are applied client‑side.
 * - `fetchMore()` advances the page; `refetch()` forces a fresh API call.
 * - The full result set is held in a ref so cached data survives re‑renders
 *   caused by parent state changes.
 *
 * @param options - Optional filters and page size
 * @returns {UsePetListReturn}
 */
export function usePetList(options: UsePetListOptions = {}): UsePetListReturn {
  const { species, search, pageSize = DEFAULT_PAGE_SIZE } = options;

  const [allPets, setAllPets] = useState<Pet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const mountedRef = useRef(true);

  // Ref mirror of allPets so fetchPets can read length without listing
  // allPets as a dependency (keeping the callback stable).
  const allPetsRef = useRef(allPets);
  allPetsRef.current = allPets;

  // ── Client‑side filtering ───────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = allPets;

    if (species) {
      list = list.filter((p) => p.species === species);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.breed ?? '').toLowerCase().includes(q),
      );
    }

    return list;
  }, [allPets, species, search]);

  // ── Client‑side pagination ──────────────────────────────────────────────

  const total = filtered.length;
  const hasMore = page * pageSize < total;
  const pets = useMemo(() => filtered.slice(0, page * pageSize), [filtered, page, pageSize]);

  // ── Fetch (once on mount; refetch forces a fresh call) ─────────────────

  const fetchPets = useCallback(async (force = false) => {
    // Reuse cached data when already loaded and not forced
    if (!force && allPetsRef.current.length > 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await getAllPets();
      if (!mountedRef.current) return;
      setAllPets(data);
      setPage(1);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load pets');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  // ── Public actions ──────────────────────────────────────────────────────

  const fetchMore = useCallback(() => {
    setPage((p) => (p * pageSize < total ? p + 1 : p));
  }, [pageSize, total]);

  const refetch = useCallback(async () => {
    await fetchPets(true);
  }, [fetchPets]);

  // ── Initial fetch + cleanup ─────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    fetchPets();

    return () => {
      mountedRef.current = false;
    };
  }, []); // fetchPets is stable (ref‑based guard) — only run on mount

  return { pets, isLoading, error, fetchMore, refetch, hasMore, total };
}

export default usePetList;
