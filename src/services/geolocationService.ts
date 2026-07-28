/**
 * geolocationService.ts
 *
 * Service for device geolocation used by the nearby-vet and emergency-SOS
 * features.  Handles permission requests, coordinate retrieval, validation,
 * distance calculation, and a lightweight "search nearby" helper that
 * filters any array of located items by radius.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';

import { logError } from '../utils/errorLogger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GeolocationResult {
  coordinates: Coordinates;
  accuracy: number;
  /** Unix epoch in seconds */
  timestamp: number;
}

export interface NearbyItem extends Coordinates {
  /** Straight-line distance from the user in kilometres (populated at call time) */
  distanceKm?: number;
}

export type LocationPermissionStatus = 'granted' | 'denied' | 'unavailable';

// ─── Errors ───────────────────────────────────────────────────────────────────

export class GeolocationError extends Error {
  constructor(
    message: string,
    public readonly code: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'INVALID',
  ) {
    super(message);
    this.name = 'GeolocationError';
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_AGE_MS = 30_000;
const EARTH_RADIUS_KM = 6_371;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Haversine formula — straight-line distance in kilometres between two
 * WGS-84 coordinates.
 */
export function calculateDistance(from: Coordinates, to: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) *
      Math.cos(toRad(to.latitude)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Validates that a coordinate pair is within the legal WGS-84 range.
 *
 * Returns `true` for valid coordinates, `false` otherwise.
 */
export function isValidCoordinate(coords: Coordinates): boolean {
  const { latitude, longitude } = coords;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    !isNaN(latitude) &&
    !isNaN(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

// ─── Permission ───────────────────────────────────────────────────────────────

/**
 * Requests the location permission appropriate for the current platform.
 *
 * - iOS: `Geolocation.requestAuthorization()` (triggers the native prompt)
 * - Android: `PermissionsAndroid.request()` for `ACCESS_FINE_LOCATION`
 *
 * Returns `'granted'`, `'denied'`, or `'unavailable'`.
 */
export async function requestLocationPermission(): Promise<LocationPermissionStatus> {
  try {
    if (Platform.OS === 'ios') {
      // The Geolocation module triggers the iOS permission prompt automatically
      // on the first `getCurrentPosition` call; calling `requestAuthorization`
      // ensures the prompt appears before the first position request.
      Geolocation.requestAuthorization();
      return 'granted';
    }

    if (Platform.OS === 'android') {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message:
            'PetChain needs your location to find nearby vet clinics and emergency services.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
          buttonNeutral: 'Ask Me Later',
        },
      );

      if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'unavailable';
      return 'denied';
    }

    // Unsupported platform (web preview, etc.)
    return 'unavailable';
  } catch (cause) {
    logError(cause instanceof Error ? cause : new Error(String(cause)), {
      service: 'geolocationService',
      action: 'requestLocationPermission',
    });
    return 'unavailable';
  }
}

// ─── Core location fetch ──────────────────────────────────────────────────────

/**
 * Resolves the device's current GPS position.
 *
 * Automatically requests permission before querying the hardware.
 *
 * @throws {GeolocationError} when permission is denied, the position is
 *   unavailable, or the request times out.
 */
export async function getCurrentLocation(options?: {
  timeoutMs?: number;
  maximumAgeMs?: number;
  highAccuracy?: boolean;
}): Promise<GeolocationResult> {
  const permission = await requestLocationPermission();

  if (permission === 'denied') {
    throw new GeolocationError(
      'Location permission was denied. Please enable it in your device settings.',
      'PERMISSION_DENIED',
    );
  }

  if (permission === 'unavailable') {
    throw new GeolocationError(
      'Location services are unavailable on this device.',
      'POSITION_UNAVAILABLE',
    );
  }

  return new Promise<GeolocationResult>((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (position) => {
        const coords: Coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        if (!isValidCoordinate(coords)) {
          reject(
            new GeolocationError(
              'Received invalid coordinates from the device.',
              'POSITION_UNAVAILABLE',
            ),
          );
          return;
        }

        resolve({
          coordinates: coords,
          accuracy: position.coords.accuracy ?? 0,
          timestamp: Math.floor(position.timestamp / 1000),
        });
      },
      (error) => {
        // Map native error codes to GeolocationError
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        const codeMap: Record<number, GeolocationError['code']> = {
          1: 'PERMISSION_DENIED',
          2: 'POSITION_UNAVAILABLE',
          3: 'TIMEOUT',
        };
        const code: GeolocationError['code'] = codeMap[error.code] ?? 'POSITION_UNAVAILABLE';
        reject(new GeolocationError(error.message, code));
      },
      {
        enableHighAccuracy: options?.highAccuracy ?? true,
        timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maximumAge: options?.maximumAgeMs ?? DEFAULT_MAX_AGE_MS,
      },
    );
  });
}

// ─── Search nearby ────────────────────────────────────────────────────────────

/**
 * Filters an array of located items to those within `radiusKm` of the user's
 * current position, annotating each with `distanceKm` and sorting
 * nearest-first.
 *
 * The function requests the current location internally — callers do not need
 * to provide coordinates.
 *
 * @param items - Array of objects with `latitude` and `longitude` fields.
 * @param radiusKm - Search radius in kilometres (default: 10).
 *
 * @throws {GeolocationError} when the device location cannot be determined.
 */
export async function searchNearby<T extends NearbyItem>(
  items: T[],
  radiusKm = 10,
): Promise<T[]> {
  const { coordinates: userCoords } = await getCurrentLocation();

  const withDistance = items.map((item) => ({
    ...item,
    distanceKm: calculateDistance(userCoords, { latitude: item.latitude, longitude: item.longitude }),
  }));

  return withDistance
    .filter((item) => item.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
