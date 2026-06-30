/**
 * LostFoundService — backend
 *
 * Handles CRUD for lost/found pet reports and PostGIS-based spatial queries.
 *
 * Key features:
 *  - ST_DWithin  — find reports within a radius (geofence matching)
 *  - notifyOwners — when a "found" report is filed, query all active "lost"
 *    report owners whose geofence (5 km) overlaps the found location, then
 *    emit push notifications via pushService.
 */

import { query } from '../src/db/index';
import pushService from './pushService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LostFoundType = 'lost' | 'found';

export interface LostFoundLocation {
  latitude: number;
  longitude: number;
}

export interface LostFoundReport {
  id: string;
  type: LostFoundType;
  title: string;
  description: string;
  species: string;
  breed?: string;
  photoUrl?: string;
  location: LostFoundLocation;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

const POSTGIS_SRID = 4326;
const METERS_PER_KM = 1000;
const GEOFENCE_RADIUS_KM = 5;
const GEOFENCE_TTL_DAYS = 30;

// ─── Spatial helpers ──────────────────────────────────────────────────────────

/**
 * Find all "found" reports within radiusKm of a given lost report's location.
 * Uses PostGIS ST_DWithin for index-accelerated spatial filtering.
 */
export async function findFoundReportsNear(
  center: LostFoundLocation,
  radiusKm: number,
  excludeId?: string,
): Promise<LostFoundReport[]> {
  const result = await query(
    `
    SELECT
      id,
      type,
      title,
      description,
      species,
      breed,
      photo_url       AS "photoUrl",
      owner_id        AS "ownerId",
      created_at      AS "createdAt",
      updated_at      AS "updatedAt",
      expires_at      AS "expiresAt",
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude
    FROM lost_found_reports
    WHERE type = 'found'
      ${excludeId ? 'AND id != $3' : ''}
      AND ST_DWithin(
        location::geography,
        ST_SetSRID(ST_Point($1, $2), ${POSTGIS_SRID})::geography,
        ${radiusKm * METERS_PER_KM}
      )
    ORDER BY created_at DESC
    `,
    excludeId
      ? [center.longitude, center.latitude, excludeId]
      : [center.longitude, center.latitude],
  );

  return result.rows.map(rowToReport);
}

/**
 * Find all active "lost" report owners whose geofence (GEOFENCE_RADIUS_KM)
 * overlaps the given location. Used when a new found report is filed.
 *
 * Returns rows with { ownerId, reportId, title } so push notifications can be
 * personalised per owner.
 */
export async function findLostReportOwnersNear(
  location: LostFoundLocation,
  radiusKm = GEOFENCE_RADIUS_KM,
): Promise<Array<{ ownerId: string; reportId: string; title: string }>> {
  const expiryThreshold = new Date(
    Date.now() - GEOFENCE_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result = await query(
    `
    SELECT
      id        AS "reportId",
      owner_id  AS "ownerId",
      title
    FROM lost_found_reports
    WHERE type = 'lost'
      AND created_at > $3
      AND ST_DWithin(
        location::geography,
        ST_SetSRID(ST_Point($1, $2), ${POSTGIS_SRID})::geography,
        $4
      )
    `,
    [location.longitude, location.latitude, expiryThreshold, radiusKm * METERS_PER_KM],
  );

  return result.rows as Array<{ ownerId: string; reportId: string; title: string }>;
}

/**
 * Called when a new "found" report is created.
 * Finds all lost-pet owners whose geofence overlaps the found location and
 * sends each a push notification that deep-links to the found report.
 */
export async function notifyNearbyLostPetOwners(
  foundReportId: string,
  foundTitle: string,
  location: LostFoundLocation,
): Promise<number> {
  let notified = 0;
  try {
    const owners = await findLostReportOwnersNear(location);

    await Promise.allSettled(
      owners.map(async (owner) => {
        await pushService.sendPushToUser(owner.ownerId, {
          title: '🐾 Possible match found nearby!',
          body: `A "found pet" was reported near your lost pet "${owner.title}". Tap to view.`,
          data: {
            type: 'lost_found_match',
            deepLink: `petchain://lost-found/${encodeURIComponent(foundReportId)}`,
            lostReportId: owner.reportId,
            foundReportId,
          },
        });
        notified++;
      }),
    );
  } catch (err) {
    console.error('[LostFoundService] notifyNearbyLostPetOwners error', err);
  }
  return notified;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getLostFoundReports(params?: {
  type?: LostFoundType;
  species?: string;
  radiusKm?: number;
  latitude?: number;
  longitude?: number;
}): Promise<{ reports: LostFoundReport[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params?.type) {
    conditions.push(`type = $${idx++}`);
    values.push(params.type);
  }
  if (params?.species) {
    conditions.push(`LOWER(species) = LOWER($${idx++})`);
    values.push(params.species);
  }
  if (params?.latitude != null && params?.longitude != null && params?.radiusKm) {
    conditions.push(
      `ST_DWithin(
        location::geography,
        ST_SetSRID(ST_Point($${idx++}, $${idx++}), ${POSTGIS_SRID})::geography,
        $${idx++}
      )`,
    );
    values.push(params.longitude, params.latitude, params.radiusKm * METERS_PER_KM);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `
    SELECT
      id, type, title, description, species, breed,
      photo_url  AS "photoUrl",
      owner_id   AS "ownerId",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      expires_at AS "expiresAt",
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude
    FROM lost_found_reports
    ${where}
    ORDER BY created_at DESC
    `,
    values,
  );

  const reports = result.rows.map(rowToReport);
  return { reports, total: reports.length };
}

export async function createLostFoundReport(data: {
  type: LostFoundType;
  title: string;
  description: string;
  species: string;
  breed?: string;
  photoUrl?: string;
  location: LostFoundLocation;
  ownerId: string;
}): Promise<LostFoundReport> {
  const expiresAt = new Date(
    Date.now() + GEOFENCE_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result = await query(
    `
    INSERT INTO lost_found_reports
      (type, title, description, species, breed, photo_url, location, owner_id, expires_at)
    VALUES
      ($1, $2, $3, $4, $5, $6,
       ST_SetSRID(ST_Point($7, $8), ${POSTGIS_SRID}),
       $9, $10)
    RETURNING
      id, type, title, description, species, breed,
      photo_url  AS "photoUrl",
      owner_id   AS "ownerId",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      expires_at AS "expiresAt",
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude
    `,
    [
      data.type,
      data.title,
      data.description,
      data.species,
      data.breed ?? null,
      data.photoUrl ?? null,
      data.location.longitude,
      data.location.latitude,
      data.ownerId,
      expiresAt,
    ],
  );

  return rowToReport(result.rows[0]);
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToReport(row: Record<string, unknown>): LostFoundReport {
  return {
    id: String(row.id),
    type: String(row.type) as LostFoundType,
    title: String(row.title),
    description: String(row.description),
    species: String(row.species),
    breed: row.breed ? String(row.breed) : undefined,
    photoUrl: row.photoUrl ? String(row.photoUrl) : undefined,
    location: {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    },
    ownerId: String(row.ownerId),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    expiresAt: row.expiresAt ? String(row.expiresAt) : undefined,
  };
}
