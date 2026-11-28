import { create } from 'zustand';

export type ClinicHours = {
  day: string;
  open: string;
  close: string;
  closed?: boolean;
};

export type EmergencyClinic = {
  id: string;
  name: string;
  phone: string;
  address: string;
  hours: ClinicHours[];
  isEmergency: boolean;
  sourceUpdatedAt: string;
};

export type EmergencyDirectoryStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'unavailable';

export type EmergencyDirectoryState = {
  clinics: EmergencyClinic[];
  status: EmergencyDirectoryStatus;
  lastFetchedAt: string | null;
  error: string | null;
  loadDirectory: (fetcher: () => Promise<EmergencyClinic[]>) => Promise<void>;
  reset: () => void;
};

const STALE_MS = 1000 * 60 * 60 * 24;

function isStale(lastFetchedAt: string | null): boolean {
  if (!lastFetchedAt) return true;
  const age = Date.now() - new Date(lastFetchedAt).getTime();
  return Number.isNaN(age) || age > STALE_MS;
}

export const useEmergencyStore = create<EmergencyDirectoryState>((set, get) => ({
  clinics: [],
  status: 'idle',
  lastFetchedAt: null,
  error: null,

  loadDirectory: async (fetcher) => {
    set({ status: 'loading', error: null });
    try {
      const clinics = await fetcher();
      const lastFetchedAt = new Date().toISOString();
      set({
        clinics,
        lastFetchedAt,
        status: clinics.length === 0 ? 'unavailable' : 'ready',
      });
    } catch (err) {
      const existing = get().clinics;
      const message = err instanceof Error ? err.message : 'Unable to load directory';
      if (existing.length > 0) {
        set({ status: 'stale', error: message });
      } else {
        set({ status: 'unavailable', error: message });
      }
    }
  },

  reset: () =>
    set({ clinics: [], status: 'idle', lastFetchedAt: null, error: null }),
}));

export function isDirectoryStale(lastFetchedAt: string | null): boolean {
  return isStale(lastFetchedAt);
}
