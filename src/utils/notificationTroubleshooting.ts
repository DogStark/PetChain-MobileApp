/**
 * Notification delivery troubleshooting helpers — Issue #1208.
 *
 * Builds the data behind the troubleshooting view: OS permission state
 * combined with server-confirmed settings, Android channel status, the last
 * known server snapshot, and platform-specific fix steps.
 *
 * Nothing here reads notification content or pet data. A cached snapshot is
 * shown as stale and never treated as server-confirmed while offline.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getServerPreferences } from '../services/notificationService';
import {
  getNotificationPermissionState,
  type NotificationPermissionResult,
} from './permissions';

export const NOTIFICATION_SNAPSHOT_STORAGE_KEY = '@notification_delivery_snapshot';

/** Snapshots older than this are shown as stale. */
export const NOTIFICATION_SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000;

export interface NotificationDeliverySnapshot {
  remindersEnabled: boolean;
  /** Epoch ms of the server response that produced this snapshot. */
  fetchedAt: number;
}

export interface NotificationChannelStatus {
  id: string;
  name: string;
  enabled: boolean;
}

export interface NotificationTroubleshootingReport {
  permission: NotificationPermissionResult;
  snapshot: NotificationDeliverySnapshot | null;
  /** True when `snapshot` was read from the cache because the server was unreachable. */
  snapshotFromCache: boolean;
  isStale: boolean;
  channels: NotificationChannelStatus[];
  steps: string[];
}

function isSnapshot(value: unknown): value is NotificationDeliverySnapshot {
  const candidate = value as Partial<NotificationDeliverySnapshot> | null;
  return (
    typeof candidate?.fetchedAt === 'number' && typeof candidate?.remindersEnabled === 'boolean'
  );
}

/**
 * Fetches the account's notification settings from the server and caches them.
 * Throws when offline or signed out so callers can fall back to the cache.
 */
export async function refreshNotificationDeliverySnapshot(
  now: number = Date.now(),
): Promise<NotificationDeliverySnapshot> {
  const prefs = await getServerPreferences();
  const snapshot: NotificationDeliverySnapshot = {
    remindersEnabled: prefs.enabled === true,
    fetchedAt: now,
  };
  await AsyncStorage.setItem(NOTIFICATION_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

/** Reads the last cached snapshot. Never throws; returns `null` when absent or corrupt. */
export async function readCachedNotificationDeliverySnapshot(): Promise<NotificationDeliverySnapshot | null> {  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_SNAPSHOT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Android notification channels and whether each one is switched on. iOS returns `[]`. */
export async function getNotificationChannelStatuses(): Promise<NotificationChannelStatus[]> {
  if (Platform.OS !== 'android') {
    return [];
  }
  try {
    const channels = (await Notifications.getNotificationChannelsAsync()) ?? [];
    return channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      enabled: channel.importance !== Notifications.AndroidImportance.NONE,
    }));
  } catch {
    return [];
  }
}

/** Platform-specific steps for turning notification delivery back on. */
export function getNotificationFixSteps(platform: string): string[] {
  if (platform === 'ios') {
    return [
      'Open the Settings app and tap PetChain.',
      'Tap Notifications and turn on Allow Notifications.',
      'Turn on Lock Screen, Banners, and Sounds so reminders are visible and audible.',
      'Return to PetChain and tap Retry.',
    ];
  }
  if (platform === 'android') {
    return [
      'Open the Settings app, then go to Apps, PetChain, and Notifications.',
      'Turn on Allow notifications.',
      'Make sure none of the channels listed below are set to Off.',
      'Return to PetChain and tap Retry.',
    ];
  }
  return [
    'Check that notifications are allowed for PetChain in your device settings.',
    'Return to PetChain and tap Retry.',
  ];
}

/**
 * Builds the troubleshooting report. Prefers a live server response, falls back
 * to the cached snapshot when offline, and never throws.
 */
export async function buildNotificationTroubleshootingReport(
  now: number = Date.now(),
): Promise<NotificationTroubleshootingReport> {
  let snapshot: NotificationDeliverySnapshot | null = null;
  let snapshotFromCache = false;
  try {
    snapshot = await refreshNotificationDeliverySnapshot(now);
  } catch {
    snapshot = await readCachedNotificationDeliverySnapshot();
    snapshotFromCache = snapshot !== null;
  }

  // Only a live server response counts as confirmation.
  const serverSettings = snapshot
    ? { confirmed: !snapshotFromCache, remindersEnabled: snapshot.remindersEnabled }
    : null;
  const permission = await getNotificationPermissionState(serverSettings);

  return {
    permission,
    snapshot,
    snapshotFromCache,
    isStale: snapshot !== null && now - snapshot.fetchedAt > NOTIFICATION_SNAPSHOT_STALE_MS,
    channels: await getNotificationChannelStatuses(),
    steps: getNotificationFixSteps(Platform.OS),
  };
}
