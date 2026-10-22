import { randomUUID } from 'crypto';

import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { ok, sendError } from '../../server/response';
import {
  findNearbyMatches,
  isFoundReportExpired,
  type LostFoundLocation,
  type LostFoundReport,
} from '../../services/matchingService';
import { sendNotification } from '../../services/notificationTemplateService';

const router = express.Router();
router.use(authenticateJWT);

const REPORT_EXPIRY_DAYS = 30;
const DEFAULT_ALERT_RADIUS_KM = 30;
const USER_LOCATION_STALE_MS = 24 * 60 * 60 * 1000;
/** Accuracy in meters above which a sighting is considered low-confidence. */
const LAWQ_CONFIDENCE_ACCURACY_METERS = 500;
/** Sightings older than this are considered stale. */
const STALE_SIGHTING_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredLostFoundReport extends LostFoundReport {
  ownerId: string;
  expiresAt?: string;
  /** ISO timestamp of when the location was recorded on the device. */
  locationTimestamp?: string;
  /** Reported GPS accuracy in meters. */
  accuracy?: number;
}

interface StoredUserLocation extends LostFoundLocation {
  updatedAt: string;
  accuracy?: number;
}

const reports = new Map<string, StoredLostFoundReport>();
const userLocations = new Map<string, StoredUserLocation>();

function cleanupExpiredReports(): void {
  const now = Date.now();
  for (const [id, report] of reports.entries()) {
    if (report.type === 'found' && report.expiresAt && Date.parse(report.expiresAt) < now) {
      reports.delete(id);
    }
  }
}

function normalizeReportType(value: unknown): 'lost' | 'found' | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase().trim();
  return normalized === 'lost' || normalized === 'found' ? normalized : undefined;
}

function parseLocation(value: unknown): LostFoundLocation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const payload = value as { latitude?: unknown; longitude?: unknown };
  const latitude =
    typeof payload.latitude === 'number' ? payload.latitude : Number(payload.latitude);
  const longitude =
    typeof payload.longitude === 'number' ? payload.longitude : Number(payload.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }
  return undefined;
}

/** Parse an optional non-negative numeric accuracy value (meters). */
function parseAccuracy(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return num;
}

/** Parse an optional ISO timestamp, rejecting invalid or future values. */
function parseTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  // Tolerate small clock skew (5 minutes) but reject clearly future timestamps.
  if (parsed > Date.now() + 5 * 60 * 1000) return undefined;
  return new Date(parsed).toISOString();
}

function isStaleSighting(report: StoredLostFoundReport): boolean {
  const reference = report.locationTimestamp ?? report.createdAt;
  const parsed = Date.parse(reference);
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > STALE_SIGHTING_MS;
}

function isLowConfidence(report: StoredLostFoundReport): boolean {
  return typeof report.accuracy === 'number' && report.accuracy > LAWQ_CONFIDENCE_ACCURACY_METERS;
}

function reportResponse(report: StoredLostFoundReport) {
  const stale = isStaleSighting(report);
  const lowConfidence = isLowConfidence(report);
  return {
    id: report.id,
    type: report.type,
    title: report.title,
    description: report.description,
    species: report.species,
    breed: report.breed,
    photoUrl: report.photoUrl,
    location: report.location,
    // Accuracy and timestamp are surfaced so the mobile map can render confidence.
    accuracy: report.accuracy,
    locationTimestamp: report.locationTimestamp ?? report.createdAt,
    stale,
    lowConfidence,
    ownerId: report.ownerId,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    expiresAt: report.expiresAt,
  };
}

async function broadcastLostReport(report: StoredLostFoundReport, radiusKm: number): Promise<void> {
  const now = Date.now();
  const nearbyUsers = [...userLocations.entries()]
    .filter(([userId, location]) => {
      if (userId === report.ownerId) return false;
      if (now - Date.parse(location.updatedAt) > USER_LOCATION_STALE_MS) return false;
      const latDelta = location.latitude - report.location.latitude;
      const lonDelta = location.longitude - report.location.longitude;
      const approxkm = Math.sqrt(latDelta * latDelta + lonDelta * lonDelta) * 111;
      return approxkm <= radiusKm;
    })
    .map(([userId]) => userId);

  await Promise.all(
    nearbyUsers.map((userId) =>
      sendNotification(
        userId,
        'lost_pet_alert',
        { reportId: report.id },
        {
          topic: 'sos_notifications',
          data: { reportId: report.id, route: 'LostFound' },
        },
      ),
    ),
  );
}

router.get('/reports', (req, res) => {
  cleanupExpiredReports();

  const type = normalizeReportType(req.query.type) ?? 'lost';
  const species =
    typeof req.query.species === 'string' ? req.query.species.trim().toLowerCase() : undefined;
  const breed =
    typeof req.query.breed === 'string' ? req.query.breed.trim().toLowerCase() : undefined;
  const radiusKm = Number(req.query.radiusKm) || DEFAULT_ALERT_RADIUS_KM;
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);

  let result = [...reports.values()].filter((report) => report.type === type);
  if (type === 'found') {
    result = result.filter((report) => !isFoundReportExpired(report));
  }

  if (species) {
    result = result.filter((report) => report.species.toLowerCase() === species);
  }

  if (breed) {
    result = result.filter((report) => report.breed?.toLowerCase() === breed);
  }

  if (hasLocation) {
    result = result.filter((report) => {
      const latDelta = report.location.latitude - latitude;
      const lonDelta = report.location.longitude - longitude;
      const approxkm = Math.sqrt(latDelta * latDelta + lonDelta * lonDelta) * 111;
      return approxkm <= radiusKm;
    });
  }

  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return res.json(ok({ data: result.map(reportResponse), total: result.length }));
});

router.get('/reports/:id', (req, res) => {
  cleanupExpiredReports();
  const report = reports.get(req.params.id);
  if (!report || (report.type === 'found' && isFoundReportExpired(report))) {
    return sendError(res, 404, 'NOT_FOUND', 'Report not found');
  }
  return res.json(ok(reportResponse(report)));
});

router.get('/reports/:id/matches', async (req, res) => {
  cleanupExpiredReports();
  const report = reports.get(req.params.id);
  if (!report || (report.type === 'found' && isFoundReportExpired(report))) {
    return sendError(res, 404, 'NOT_FOUND', 'Report not found');
  }

  const candidates = [...reports.values()].filter((candidate) => candidate.id !== report.id);
  const matches = await findNearbyMatches(
    report,
    candidates,
    Number(req.query.radiusKm) || DEFAULT_ALERT_RADIUS_KM,
  );
  return res.json(ok({ data: matches.map(reportResponse), total: matches.length }));
});

router.post('/reports', async (req: AuthenticatedRequest, res) => {
  const {
    type: rawType,
    title: rawTitle,
    description: rawDescription,
    species: rawSpecies,
    breed: rawBreed,
    photoUrl: rawPhotoUrl,
    location: rawLocation,
    accuracy: rawAccuracy,
    locationTimestamp: rawLocationTimestamp,
  } = req.body as Record<string, unknown>;

  const type = normalizeReportType(rawType);
  if (!type) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'type must be lost or found');
  }

  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : '';
  const species = typeof rawSpecies === 'string' ? rawSpecies.trim() : '';
  const breed = typeof rawBreed === 'string' ? rawBreed.trim() : undefined;
  const photoUrl = typeof rawPhotoUrl === 'string' ? rawPhotoUrl.trim() : undefined;
  const location = parseLocation(rawLocation);
  const accuracy = parseAccuracy(rawAccuracy);
  const locationTimestamp = parseTimestamp(rawLocationTimestamp);

  if (!title || !species || !location) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'title, species, and location are required');
  }

  if (rawAccuracy !== undefined && accuracy === undefined) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'accuracy must be a non-negative number');
  }

  if (rawLocationTimestamp !== undefined && locationTimestamp === undefined) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'locationTimestamp must be a valid ISO date');
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const report: StoredLostFoundReport = {
    id,
    type,
    title,
    description,
    species,
    breed,
    photoUrl,
    location,
    accuracy,
    locationTimestamp: locationTimestamp ?? now,
    ownerId: req.user!.id,
    createdAt: now,
    updatedAt: now,
    expiresAt:
      type === 'found'
        ? new Date(Date.now() + REPORT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString()
        : undefined,
  };

  reports.set(id, report);

  if (type === 'lost') {
    await broadcastLostReport(report, DEFAULT_ALERT_RADIUS_KM);
  }

  return res.status(201).json(ok({ data: reportResponse(report) }));
});

router.post('/location', (req: AuthenticatedRequest, res) => {
  const location = parseLocation(req.body);
  if (!location) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'latitude and longitude are required');
  }
  const accuracy = parseAccuracy((req.body as { accuracy?: unknown }).accuracy);
  userLocations.set(req.user!.id, {
    ...location,
    accuracy,
    updatedAt: new Date().toISOString(),
  });
  return res.status(201).json(ok({ data: { updated: true } }));
});

export default router;
