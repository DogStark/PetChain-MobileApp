import { Platform, Linking } from 'react-native';
import * as Location from 'expo-location';
import { apiClient } from '../api/client';
import { storage } from '../utils/storage';
import { logger } from '../utils/logger';

export type LocationPermissionStatus =
  | 'granted'
  | 'denied'
  | 'revoked'
  | 'undetermined';

export interface SosCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

export interface SosLocationResult {
  status: LocationPermissionStatus;
  coordinates: SosCoordinates | null;
  degraded: boolean;
  message: string;
  canOpenSettings: boolean;
}

export interface SosPayload {
  petId?: string;
  message?: string;
  coordinates: SosCoordinates | null;
  locationStatus: LocationPermissionStatus;
  degraded: boolean;
  createdAt: string;
}

const SOS_QUEUE_KEY = 'sos.pendingQueue';

const DEGRADED_MESSAGES: Record<LocationPermissionStatus, string> = {
  granted: '',
  denied:
    'Location access is off, so your emergency contact will not receive your coordinates. You can still send the SOS alert.',
  revoked:
    'Location access was turned off, so your emergency contact will not receive your coordinates. You can still send the SOS alert.',
  undetermined:
    'Location access has not been granted, so your emergency contact will not receive your coordinates. You can still send the SOS alert.',
};

/**
 * Resolve the current location permission state from the platform and map it
 * to a server-confirmed status. We never assume a cached local value; the
 * platform is the source of truth and the result is sent to the server so it
 * can confirm the degraded state.
 */
export async function resolveLocationPermission(): Promise<LocationPermissionStatus> {
  try {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') {
      return 'granted';
    }
    if (status === 'denied') {
      return canAskAgain ? 'denied' : 'revoked';
    }
    return 'undetermined';
  } catch (error) {
    logger.warn('Failed to read location permission', error);
    return 'undetermined';
  }
}

/**
 * Attempt to obtain coordinates. Returns a degraded result (no coordinates)
 * when permission is denied or revoked so the SOS flow can continue.
 */
export async function getSosLocation(): Promise<SosLocationResult> {
  const status = await resolveLocationPermission();

  if (status !== 'granted') {
    return {
      status,
      coordinates: null,
      degraded: true,
      message: DEGRADED_MESSAGES[status],
      canOpenSettings: status === 'denied' || status === 'revoked',
    };
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      status: 'granted',
      coordinates: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      },
      degraded: false,
      message: '',
      canOpenSettings: false,
    };
  } catch (error) {
    logger.warn('Failed to obtain SOS coordinates', error);
    return {
      status: 'granted',
      coordinates: null,
      degraded: true,
      message:
        'We could not get your current location, so your emergency contact will not receive your coordinates. You can still send the SOS alert.',
      canOpenSettings: false,
    };
  }
}

/**
 * Open the platform system settings so the user can re-enable location.
 */
export async function openLocationSettings(): Promise<void> {
  try {
    if (Platform.OS === 'ios') {
      await Linking.openURL('app-settings:');
    } else {
      await Linking.openSettings();
    }
  } catch (error) {
    logger.warn('Failed to open location settings', error);
  }
}

/**
 * Send an SOS alert. Coordinates are optional so the emergency contact flow
 * continues even when location permission is denied or revoked. When offline,
 * the payload is queued locally and flushed later, preserving existing
 * offline behavior.
 */
export async function sendSosAlert(input: {
  petId?: string;
  message?: string;
}): Promise<{ queued: boolean; location: SosLocationResult }> {
  const location = await getSosLocation();

  const payload: SosPayload = {
    petId: input.petId,
    message: input.message,
    coordinates: location.coordinates,
    locationStatus: location.status,
    degraded: location.degraded,
    createdAt: new Date().toISOString(),
  };

  try {
    await apiClient.post('/sos/alerts', payload);
    return { queued: false, location };
  } catch (error) {
    logger.warn('SOS alert failed, queueing for retry', error);
    await enqueueSos(payload);
    return { queued: true, location };
  }
}

async function enqueueSos(payload: SosPayload): Promise<void> {
  const existing = (await storage.get<SosPayload[]>(SOS_QUEUE_KEY)) ?? [];
  existing.push(payload);
  await storage.set(SOS_QUEUE_KEY, existing);
}

/**
 * Flush any queued SOS alerts. Called when connectivity is restored.
 */
export async function flushSosQueue(): Promise<void> {
  const queued = (await storage.get<SosPayload[]>(SOS_QUEUE_KEY)) ?? [];
  if (queued.length === 0) {
    return;
  }

  const remaining: SosPayload[] = [];
  for (const payload of queued) {
    try {
      await apiClient.post('/sos/alerts', payload);
    } catch (error) {
      logger.warn('Failed to flush queued SOS alert', error);
      remaining.push(payload);
    }
  }
  await storage.set(SOS_QUEUE_KEY, remaining);
}
