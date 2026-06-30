/**
 * GeofenceService
 *
 * Registers per-pet geofence alerts when a pet is marked as lost.
 * When a "found" report appears within 5 km of the owner's location,
 * a local push notification is sent that deep-links to the found report.
 *
 * Geofences are stored in AsyncStorage and expire after GEOFENCE_TTL_DAYS (30).
 * On expiry the owner is notified with an option to renew.
 *
 * Background polling (every POLL_INTERVAL_MS) is handled by the background
 * task declared below; the task is registered in backgroundTaskService.ts.
 */

import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { logError } from '../utils/errorLogger';
import apiClient from './apiClient';
import { getItem, setItem, removeItem } from './localDB';
import { getLostFoundReports, type LostFoundLocation } from './lostFoundService';

// ─── Constants ────────────────────────────────────────────────────────────────

export const BACKGROUND_GEOFENCE_TASK = 'BACKGROUND_GEOFENCE_TASK';

/** Geofence radius in kilometres */
const GEOFENCE_RADIUS_KM = 5;

/** How long (days) before a geofence expires and the owner is notified to renew */
const GEOFENCE_TTL_DAYS = 30;

/** How often (seconds) the background task wakes to poll for new found reports */
const POLL_INTERVAL_SECONDS = 15 * 60;

const STORAGE_KEY = '@geofence_alerts';
const NOTIFIED_KEY = '@geofence_notified_reports';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeofenceAlert {
  /** The lost-report that triggered this geofence */
  reportId: string;
  petName: string;
  ownerId: string;
  center: LostFoundLocation;
  radiusKm: number;
  createdAt: string; // ISO
  expiresAt: string; // ISO — GEOFENCE_TTL_DAYS after createdAt
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function loadGeofences(): Promise<GeofenceAlert[]> {
  try {
    const raw = await getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GeofenceAlert[]) : [];
  } catch {
    return [];
  }
}

async function saveGeofences(alerts: GeofenceAlert[]): Promise<void> {
  await setItem(STORAGE_KEY, JSON.stringify(alerts));
}

async function loadNotifiedReports(): Promise<Set<string>> {
  try {
    const raw = await getItem(NOTIFIED_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

async function addNotifiedReport(reportId: string): Promise<void> {
  const set = await loadNotifiedReports();
  set.add(reportId);
  await setItem(NOTIFIED_KEY, JSON.stringify([...set]));
}

// ─── Haversine distance (km) ──────────────────────────────────────────────────

function haversineKm(a: LostFoundLocation, b: LostFoundLocation): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const under = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371 * 2 * Math.atan2(Math.sqrt(under), Math.sqrt(1 - under));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a geofence alert when a pet is marked as lost.
 * Safe to call multiple times — updates the existing entry if reportId matches.
 */
export async function registerGeofenceAlert(alert: Omit<GeofenceAlert, 'expiresAt'>): Promise<void> {
  const alerts = await loadGeofences();

  // Remove any existing entry for the same report
  const filtered = alerts.filter((a) => a.reportId !== alert.reportId);

  const expiresAt = new Date(
    new Date(alert.createdAt).getTime() + GEOFENCE_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  filtered.push({ ...alert, radiusKm: GEOFENCE_RADIUS_KM, expiresAt });
  await saveGeofences(filtered);
  console.log(`[Geofence] Registered geofence for report ${alert.reportId}`);
}

/**
 * Remove a geofence alert (e.g. pet found / owner cancelled).
 */
export async function removeGeofenceAlert(reportId: string): Promise<void> {
  const alerts = await loadGeofences();
  await saveGeofences(alerts.filter((a) => a.reportId !== reportId));
}

/**
 * Renew the TTL of an existing geofence for another 30 days.
 */
export async function renewGeofenceAlert(reportId: string): Promise<boolean> {
  const alerts = await loadGeofences();
  const idx = alerts.findIndex((a) => a.reportId === reportId);
  if (idx === -1) return false;

  const alert = alerts[idx]!;
  alert.expiresAt = new Date(Date.now() + GEOFENCE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await saveGeofences(alerts);
  return true;
}

/**
 * Scan for new "found" reports that fall within any active geofence
 * and fire local push notifications accordingly.
 * Called from the background task and can be called manually on app foreground.
 */
export async function checkGeofenceAlerts(): Promise<number> {
  const alerts = await loadGeofences();
  if (alerts.length === 0) return 0;

  const notified = await loadNotifiedReports();
  const now = Date.now();
  let fired = 0;

  for (const alert of alerts) {
    // Notify owner when geofence has expired
    if (Date.parse(alert.expiresAt) <= now) {
      await _fireExpiryNotification(alert);
      continue;
    }

    // Fetch nearby "found" reports for this geofence center
    let foundReports: Awaited<ReturnType<typeof getLostFoundReports>>['reports'] = [];
    try {
      const res = await getLostFoundReports({
        type: 'found',
        latitude: alert.center.latitude,
        longitude: alert.center.longitude,
        radiusKm: alert.radiusKm,
      });
      foundReports = res.reports;
    } catch {
      // Non-fatal — will retry next poll
      continue;
    }

    for (const report of foundReports) {
      if (notified.has(report.id)) continue;
      if (haversineKm(report.location, alert.center) > alert.radiusKm) continue;

      await _fireFoundNotification(alert, report.id, report.title);
      await addNotifiedReport(report.id);
      fired++;
    }
  }

  return fired;
}

// ─── Notification helpers ─────────────────────────────────────────────────────

async function _fireFoundNotification(
  alert: GeofenceAlert,
  foundReportId: string,
  foundTitle: string,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🐾 Possible match found nearby!',
      body: `A "found pet" report near your lost ${alert.petName} was filed: "${foundTitle}". Tap to view.`,
      data: {
        type: 'lost_found_match',
        deepLink: `petchain://lost-found/${encodeURIComponent(foundReportId)}`,
        lostReportId: alert.reportId,
        foundReportId,
      },
      categoryIdentifier: 'alert',
    },
    trigger: null, // fire immediately
  });
}

async function _fireExpiryNotification(alert: GeofenceAlert): Promise<void> {
  // Only fire once per geofence expiry
  const key = `${NOTIFIED_KEY}_expiry_${alert.reportId}`;
  const already = await getItem(key);
  if (already) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '⏰ Lost pet alert expired',
      body: `Your geofence alert for ${alert.petName} has expired after 30 days. Tap to renew.`,
      data: {
        type: 'geofence_expired',
        deepLink: `petchain://lost-found/renew/${encodeURIComponent(alert.reportId)}`,
        reportId: alert.reportId,
      },
      categoryIdentifier: 'alert',
    },
    trigger: null,
  });
  await setItem(key, '1');
}

// ─── Backend: index found reports (PostGIS) ───────────────────────────────────

/**
 * Query the backend to find all "lost" report owners whose geofence overlaps
 * the given found-report location. Called server-side after a found report
 * is created; the backend then triggers FCM/APNs pushes via pushService.
 *
 * POST /lost-found/notify-owners  { foundReportId, latitude, longitude }
 */
export async function notifyOwnersByFoundReport(
  foundReportId: string,
  location: LostFoundLocation,
): Promise<void> {
  try {
    await apiClient.post('/lost-found/notify-owners', {
      foundReportId,
      latitude: location.latitude,
      longitude: location.longitude,
      radiusKm: GEOFENCE_RADIUS_KM,
    });
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), {
      context: 'notifyOwnersByFoundReport',
    });
  }
}

// ─── Background Task ──────────────────────────────────────────────────────────

TaskManager.defineTask(BACKGROUND_GEOFENCE_TASK, async () => {
  try {
    const fired = await checkGeofenceAlerts();
    return fired > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), {
      context: BACKGROUND_GEOFENCE_TASK,
    });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerGeofenceBackgroundTask(): Promise<void> {
  try {
    const already = await TaskManager.isTaskRegisteredAsync(BACKGROUND_GEOFENCE_TASK);
    if (already) return;
    await BackgroundFetch.registerTaskAsync(BACKGROUND_GEOFENCE_TASK, {
      minimumInterval: POLL_INTERVAL_SECONDS,
      stopOnTerminate: false,
      startOnBoot: true,
    });
    console.log('[Geofence] Background task registered');
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), {
      context: 'registerGeofenceBackgroundTask',
    });
  }
}

export async function unregisterGeofenceBackgroundTask(): Promise<void> {
  try {
    const already = await TaskManager.isTaskRegisteredAsync(BACKGROUND_GEOFENCE_TASK);
    if (already) await BackgroundFetch.unregisterTaskAsync(BACKGROUND_GEOFENCE_TASK);
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), {
      context: 'unregisterGeofenceBackgroundTask',
    });
  }
}

const geofenceService = {
  registerGeofenceAlert,
  removeGeofenceAlert,
  renewGeofenceAlert,
  checkGeofenceAlerts,
  notifyOwnersByFoundReport,
  registerGeofenceBackgroundTask,
  unregisterGeofenceBackgroundTask,
};

export default geofenceService;
