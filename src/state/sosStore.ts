import { create } from 'zustand';

export type LocationPermissionStatus =
  | 'granted'
  | 'denied'
  | 'revoked'
  | 'undetermined';

export interface SosCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface SosLocationState {
  permission: LocationPermissionStatus;
  coordinates: SosCoordinates | null;
  /** True when the last known coordinates are older than the freshness window. */
  stale: boolean;
  /** True when the user has been told the flow is running without coordinates. */
  degraded: boolean;
  lastUpdatedAt: number | null;
}

export interface SosState extends SosLocationState {
  /**
   * Apply a server-confirmed permission status. The server is the source of
   * truth so a locally cached "granted" cannot mask a revoked permission.
   */
  setPermission: (permission: LocationPermissionStatus) => void;
  /** Record fresh coordinates and clear degraded/stale flags. */
  setCoordinates: (coordinates: SosCoordinates) => void;
  /** Mark the current coordinates as stale (e.g. after a failed refresh). */
  markStale: () => void;
  /** Acknowledge that the user has been informed of degraded behavior. */
  acknowledgeDegraded: () => void;
  /** Reset location state when the SOS flow ends. */
  resetLocation: () => void;
}

const STALE_AFTER_MS = 2 * 60 * 1000;

const initialLocationState: SosLocationState = {
  permission: 'undetermined',
  coordinates: null,
  stale: false,
  degraded: false,
  lastUpdatedAt: null,
};

/**
 * Whether the SOS flow can attach coordinates to an emergency contact request.
 * When false the flow must still continue, just without coordinates.
 */
export const hasUsableCoordinates = (state: SosLocationState): boolean =>
  state.permission === 'granted' &&
  state.coordinates !== null &&
  !state.stale;

/**
 * Whether the user should be shown guidance about degraded location behavior.
 * Denied or revoked permissions always warrant an explanation; stale data does
 * too because the coordinates can no longer be trusted.
 */
export const shouldExplainDegradedLocation = (
  state: SosLocationState,
): boolean =>
  state.permission === 'denied' ||
  state.permission === 'revoked' ||
  state.stale;

export const useSosStore = create<SosState>((set) => ({
  ...initialLocationState,

  setPermission: (permission) =>
    set((state) => {
      const lostAccess =
        permission === 'denied' || permission === 'revoked';
      return {
        permission,
        // Drop coordinates we can no longer legally use so they are never
        // attached to an emergency request after access is revoked.
        coordinates: lostAccess ? null : state.coordinates,
        stale: lostAccess ? false : state.stale,
        degraded: lostAccess ? true : state.degraded,
        lastUpdatedAt: lostAccess ? null : state.lastUpdatedAt,
      };
    }),

  setCoordinates: (coordinates) =>
    set({
      coordinates,
      stale: false,
      degraded: false,
      lastUpdatedAt: Date.now(),
    }),

  markStale: () =>
    set((state) =>
      state.coordinates === null
        ? { stale: false }
        : { stale: true, degraded: true },
    ),

  acknowledgeDegraded: () => set({ degraded: false }),

  resetLocation: () => set({ ...initialLocationState }),
}));

/**
 * Returns true when the last known coordinates have exceeded the freshness
 * window and should be treated as stale.
 */
export const isCoordinateDataStale = (
  lastUpdatedAt: number | null,
  now: number = Date.now(),
): boolean =>
  lastUpdatedAt !== null && now - lastUpdatedAt > STALE_AFTER_MS;
