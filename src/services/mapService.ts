/**
 * mapService.ts
 *
 * Offline-capable map service for nearby vet clinics, emergency animal hospitals,
 * and pet pharmacies. Handles:
 *  - Local POI database (AsyncStorage) with periodic background sync
 *  - Map tile cache metadata tracking
 *  - Distance / estimated travel time calculations
 *  - Filter helpers by clinic type
 *  - Native maps deep-link for turn-by-turn navigation
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from '@react-native-community/geolocation';
import { Linking, Platform, PermissionsAndroid } from 'react-native';

import apiClient from './apiClient';
import { networkMonitor } from '../utils/networkMonitor';

// ─── Constants ────────────────────────────────────────────────────────────────

const POI_CACHE_KEY = '@vet_map_poi_cache';
const TILE_META_KEY = '@vet_map_tile_meta';
const LAST_SYNC_KEY = '@vet_map_last_sync';

/** Re-sync POI data every 6 hours when online */
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Default search radius in kilometres */
const DEFAULT_RADIUS_KM = 15;

/** Average travel speed used for ETA estimates (km/h) */
const AVG_SPEED_KMH = 40;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClinicType = 'general' | 'emergency' | 'specialist' | 'pharmacy';

export interface ClinicSchedule {
  open: string;
  close: string;
}

export interface VetClinic {
  id: string;
  name: string;
  address: string;
  phoneNumber: string;
  latitude: number;
  longitude: number;
  type: ClinicType;
  available24h: boolean;
  rating?: number;
  /** Straight-line distance in km from the user's location (populated at query time) */
  distance?: number;
  /** Estimated travel time in minutes (populated at query time) */
  estimatedTravelMinutes?: number;
  /** ISO timestamp of last data update */
  updatedAt?: string;
  schedule?: Record<string, ClinicSchedule>;
}

export interface Location {
  latitude: number;
  longitude: number;
}

export interface TileRegion {
  /** Unique identifier for the cached region */
  id: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  /** Zoom levels cached */
  zoomLevels: number[];
  /** ISO timestamp when tiles were cached */
  cachedAt: string;
  /** Approximate tile count */
  tileCount: number;
}

export interface MapServiceState {
  isOffline: boolean;
  lastSyncAt: string | null;
  cachedClinicCount: number;
  cachedRegions: TileRegion[];
}

// ─── Seed / fallback data ─────────────────────────────────────────────────────

/**
 * Minimal seed dataset used when the device is offline and no cached data
 * exists yet. Coordinates are intentionally zeroed — the real data comes
 * from the backend sync.
 */
const SEED_CLINICS: VetClinic[] = [
  {
    id: 'seed-1',
    name: 'Pet Poison Helpline (Phone Only)',
    address: 'National — call 855-764-7661',
    phoneNumber: '855-764-7661',
    latitude: 0,
    longitude: 0,
    type: 'emergency',
    available24h: true,
  },
  {
    id: 'seed-2',
    name: 'ASPCA Animal Poison Control (Phone Only)',
    address: 'National — call 888-426-4435',
    phoneNumber: '888-426-4435',
    latitude: 0,
    longitude: 0,
    type: 'emergency',
    available24h: true,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Haversine formula — returns distance in kilometres between two coordinates.
 */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimate travel time in minutes using a fixed average speed.
 * A real implementation would call a routing API when online.
 */
function estimateTravelMinutes(distanceKm: number): number {
  return Math.round((distanceKm / AVG_SPEED_KMH) * 60);
}

/**
 * Annotate a clinic with distance and ETA relative to the user's location.
 */
function annotateClinic(clinic: VetClinic, userLat: number, userLon: number): VetClinic {
  // Skip seed clinics with zeroed coordinates
  if (clinic.latitude === 0 && clinic.longitude === 0) return clinic;
  const distance = haversineKm(userLat, userLon, clinic.latitude, clinic.longitude);
  return {
    ...clinic,
    distance: Math.round(distance * 10) / 10,
    estimatedTravelMinutes: estimateTravelMinutes(distance),
  };
}

// ─── MapService ───────────────────────────────────────────────────────────────

class MapService {
  private static instance: MapService;

  static getInstance(): MapService {
    if (!MapService.instance) {
      MapService.instance = new MapService();
    }
    return MapService.instance;
  }

  // ── Location ─────────────────────────────────────────────────────────────────

  /**
   * Request fine location permission on Android.
   * iOS prompts automatically when `getCurrentPosition` is called.
   */
  async requestLocationPermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'PetChain needs your location to show nearby vet clinics.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  }

  /**
   * Get the device's current GPS coordinates.
   */
  async getCurrentLocation(): Promise<Location> {
    const hasPermission = await this.requestLocationPermission();
    if (!hasPermission) throw new Error('Location permission denied');

    return new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        () => reject(new Error('Failed to get current location')),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
      );
    });
  }

  // ── POI cache ─────────────────────────────────────────────────────────────────

  /**
   * Load all clinics from the local AsyncStorage cache.
   * Falls back to the seed dataset if nothing is cached yet.
   */
  async getCachedClinics(): Promise<VetClinic[]> {
    try {
      const raw = await AsyncStorage.getItem(POI_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as VetClinic[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Storage read failure — fall through to seed data
    }
    return SEED_CLINICS;
  }

  /**
   * Persist a clinic list to the local cache.
   */
  private async saveClinicsToCache(clinics: VetClinic[]): Promise<void> {
    await AsyncStorage.setItem(POI_CACHE_KEY, JSON.stringify(clinics));
    await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  }

  /**
   * Determine whether the POI cache is stale and a sync should be attempted.
   */
  async isCacheStale(): Promise<boolean> {
    try {
      const raw = await AsyncStorage.getItem(LAST_SYNC_KEY);
      if (!raw) return true;
      const lastSync = new Date(raw).getTime();
      return Date.now() - lastSync > SYNC_INTERVAL_MS;
    } catch {
      return true;
    }
  }

  // ── Sync ──────────────────────────────────────────────────────────────────────

  /**
   * Fetch fresh POI data from the backend and update the local cache.
   * Silently skips if the device is offline or the cache is fresh.
   *
   * @param force - Skip the staleness check and always sync.
   */
  async syncClinics(force = false): Promise<void> {
    const online = await networkMonitor.isOnline();
    if (!online) return;

    if (!force && !(await this.isCacheStale())) return;

    try {
      const response = await apiClient.get<VetClinic[]>('/clinics');
      const clinics: VetClinic[] = Array.isArray(response.data) ? response.data : [];
      if (clinics.length > 0) {
        await this.saveClinicsToCache(clinics);
      }
    } catch {
      // Sync failure is non-fatal — the cached data remains usable
    }
  }

  /**
   * Trigger a sync on first launch (or when the cache is stale).
   * Call this from the screen's `useEffect` on mount.
   */
  async initialSync(): Promise<void> {
    await this.syncClinics();
  }

  // ── Query ─────────────────────────────────────────────────────────────────────

  /**
   * Return nearby clinics sorted by distance, optionally filtered by type.
   *
   * @param userLat   - User's latitude
   * @param userLon   - User's longitude
   * @param radiusKm  - Search radius in kilometres (default 15)
   * @param types     - Clinic types to include; empty array = all types
   */
  async getNearbyClinics(
    userLat: number,
    userLon: number,
    radiusKm = DEFAULT_RADIUS_KM,
    types: ClinicType[] = [],
  ): Promise<VetClinic[]> {
    // Attempt a background sync so data stays fresh
    void this.syncClinics();

    const all = await this.getCachedClinics();

    return all
      .filter((c) => {
        // Exclude seed clinics with no real coordinates from distance filtering
        if (c.latitude === 0 && c.longitude === 0) return false;
        if (types.length > 0 && !types.includes(c.type)) return false;
        const dist = haversineKm(userLat, userLon, c.latitude, c.longitude);
        return dist <= radiusKm;
      })
      .map((c) => annotateClinic(c, userLat, userLon))
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }

  /**
   * Return all clinics of a specific type from the cache (no location required).
   */
  async getClinicsByType(type: ClinicType): Promise<VetClinic[]> {
    const all = await this.getCachedClinics();
    return all.filter((c) => c.type === type);
  }

  /**
   * Return only 24-hour emergency clinics, sorted by distance if a location is provided.
   */
  async getEmergencyClinics(userLat?: number, userLon?: number): Promise<VetClinic[]> {
    const all = await this.getCachedClinics();
    const emergency = all.filter((c) => c.available24h);
    if (userLat !== undefined && userLon !== undefined) {
      return emergency
        .map((c) => annotateClinic(c, userLat, userLon))
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    }
    return emergency;
  }

  /**
   * Fetch full details for a single clinic by ID, falling back to local cache if offline.
   */
  async getClinicDetails(clinicId: string): Promise<VetClinic> {
    const online = await networkMonitor.isOnline();
    if (online) {
      try {
        const response = await apiClient.get<{ data: VetClinic }>(`/clinics/${clinicId}`);
        return response.data?.data ?? response.data;
      } catch {
        // Fall through to local cache
      }
    }
    const all = await this.getCachedClinics();
    const found = all.find((c) => c.id === clinicId);
    if (!found) {
      throw new Error('Clinic not found');
    }
    return found;
  }

  // ── Tile cache metadata ───────────────────────────────────────────────────────

  /**
   * Record metadata about a cached map tile region.
   * The actual tile bytes are managed by react-native-maps / the tile provider;
   * we only track metadata here so the UI can show "offline area available" badges.
   */
  async saveTileRegion(region: TileRegion): Promise<void> {
    const existing = await this.getTileRegions();
    const idx = existing.findIndex((r) => r.id === region.id);
    if (idx >= 0) {
      existing[idx] = region;
    } else {
      existing.push(region);
    }
    await AsyncStorage.setItem(TILE_META_KEY, JSON.stringify(existing));
  }

  /**
   * Retrieve all recorded tile region metadata.
   */
  async getTileRegions(): Promise<TileRegion[]> {
    try {
      const raw = await AsyncStorage.getItem(TILE_META_KEY);
      return raw ? (JSON.parse(raw) as TileRegion[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Remove a cached tile region record by ID.
   */
  async removeTileRegion(regionId: string): Promise<void> {
    const existing = await this.getTileRegions();
    await AsyncStorage.setItem(
      TILE_META_KEY,
      JSON.stringify(existing.filter((r) => r.id !== regionId)),
    );
  }

  /**
   * Check whether a given coordinate falls within any cached tile region.
   */
  async isLocationCached(lat: number, lon: number): Promise<boolean> {
    const regions = await this.getTileRegions();
    return regions.some(
      (r) => lat >= r.minLat && lat <= r.maxLat && lon >= r.minLon && lon <= r.maxLon,
    );
  }

  // ── Navigation ────────────────────────────────────────────────────────────────

  /**
   * Open the native maps app with turn-by-turn directions to a clinic.
   * Falls back to Google Maps web if the native app is unavailable.
   */
  navigateToClinic(clinic: VetClinic): void {
    const encoded = encodeURIComponent(clinic.address);
    const latLon = `${clinic.latitude},${clinic.longitude}`;

    const url = Platform.select({
      ios: clinic.latitude !== 0 ? `maps://?daddr=${latLon}&dirflg=d` : `maps:0,0?q=${encoded}`,
      android: clinic.latitude !== 0 ? `google.navigation:q=${latLon}` : `geo:0,0?q=${encoded}`,
    });

    const fallback = `https://www.google.com/maps/dir/?api=1&destination=${
      clinic.latitude !== 0 ? latLon : encoded
    }`;

    if (!url) {
      Linking.openURL(fallback);
      return;
    }

    Linking.canOpenURL(url).then((supported) => {
      Linking.openURL(supported ? url : fallback);
    });
  }

  /**
   * Open the native dialler for a clinic's phone number.
   */
  callClinic(phoneNumber: string): void {
    const url = `tel:${phoneNumber}`;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) Linking.openURL(url);
    });
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  /**
   * Return a snapshot of the map service's current state for display in the UI.
   */
  async getState(): Promise<MapServiceState> {
    const [online, clinics, regions, lastSyncRaw] = await Promise.all([
      networkMonitor.isOnline(),
      this.getCachedClinics(),
      this.getTileRegions(),
      AsyncStorage.getItem(LAST_SYNC_KEY),
    ]);

    return {
      isOffline: !online,
      lastSyncAt: lastSyncRaw,
      cachedClinicCount: clinics.length,
      cachedRegions: regions,
    };
  }

  /**
   * Clear all locally cached POI and tile metadata.
   * Does NOT clear actual tile bytes (managed by the map renderer).
   */
  async clearCache(): Promise<void> {
    await AsyncStorage.multiRemove([POI_CACHE_KEY, TILE_META_KEY, LAST_SYNC_KEY]);
  }
}

export const mapService = MapService.getInstance();
export default mapService;
