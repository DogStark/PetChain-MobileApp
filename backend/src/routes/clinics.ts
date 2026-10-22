/**
 * clinics.ts — Express router for vet clinic POI data
 *
 * Routes:
 *   GET  /clinics          — list all clinics (with optional type/radius filters)
 *   GET  /clinics/:id      — get a single clinic by ID
 *   POST /clinics          — create a clinic (admin)
 *   PUT  /clinics/:id      — update a clinic (admin)
 *   DELETE /clinics/:id    — delete a clinic (admin)
 *
 * The route handlers use an in-memory store as a reference implementation.
 * Replace the `clinicStore` with a real database (Postgres, MongoDB, etc.)
 * in production.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClinicType = 'general' | 'emergency' | 'specialist' | 'pharmacy';

export interface ClinicSchedule {
  open: string; // "HH:MM"
  close: string; // "HH:MM"
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
  schedule?: Record<string, ClinicSchedule>;
  updatedAt: string;
}

export interface CreateClinicInput {
  name: string;
  address: string;
  phoneNumber: string;
  latitude: number;
  longitude: number;
  type: ClinicType;
  available24h?: boolean;
  rating?: number;
}

export type UpdateClinicInput = Partial<CreateClinicInput>;

// ─── In-memory store (replace with DB in production) ─────────────────────────

const clinicStore: VetClinic[] = [
  {
    id: 'clinic-001',
    name: 'City Emergency Animal Hospital',
    address: '100 Emergency Blvd, Downtown',
    phoneNumber: '555-0100',
    latitude: 40.7128,
    longitude: -74.006,
    type: 'emergency',
    available24h: true,
    rating: 4.7,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'clinic-002',
    name: 'Greenfield Veterinary Clinic',
    address: '250 Oak Street, Midtown',
    phoneNumber: '555-0200',
    latitude: 40.7158,
    longitude: -74.009,
    type: 'general',
    available24h: false,
    rating: 4.5,
    schedule: {
      monday: { open: '08:00', close: '18:00' },
      tuesday: { open: '08:00', close: '18:00' },
      wednesday: { open: '08:00', close: '18:00' },
      thursday: { open: '08:00', close: '18:00' },
      friday: { open: '08:00', close: '18:00' },
      saturday: { open: '09:00', close: '14:00' },
    },
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'clinic-003',
    name: 'Advanced Pet Specialists',
    address: '75 Medical Plaza, Uptown',
    phoneNumber: '555-0300',
    latitude: 40.7198,
    longitude: -74.003,
    type: 'specialist',
    available24h: false,
    rating: 4.9,
    schedule: {
      monday: { open: '09:00', close: '17:00' },
      tuesday: { open: '09:00', close: '17:00' },
      wednesday: { open: '09:00', close: '17:00' },
      thursday: { open: '09:00', close: '17:00' },
      friday: { open: '09:00', close: '17:00' },
    },
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'clinic-004',
    name: 'PetMeds Pharmacy',
    address: '30 Commerce Ave, Eastside',
    phoneNumber: '555-0400',
    latitude: 40.7108,
    longitude: -73.998,
    type: 'pharmacy',
    available24h: false,
    rating: 4.3,
    schedule: {
      monday: { open: '08:00', close: '20:00' },
      tuesday: { open: '08:00', close: '20:00' },
      wednesday: { open: '08:00', close: '20:00' },
      thursday: { open: '08:00', close: '20:00' },
      friday: { open: '08:00', close: '20:00' },
      saturday: { open: '08:00', close: '20:00' },
      sunday: { open: '10:00', close: '16:00' },
    },
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'clinic-005',
    name: 'NightWatch Animal ER',
    address: '500 Night Owl Lane, Westside',
    phoneNumber: '555-0500',
    latitude: 40.7088,
    longitude: -74.015,
    type: 'emergency',
    available24h: true,
    rating: 4.6,
    updatedAt: new Date().toISOString(),
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `clinic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

const VALID_TYPES: ClinicType[] = ['general', 'emergency', 'specialist', 'pharmacy'];

function isValidClinicType(value: unknown): value is ClinicType {
  return typeof value === 'string' && VALID_TYPES.includes(value as ClinicType);
}

function validateCreateInput(body: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const b = body as Record<string, unknown>;

  if (!b.name || typeof b.name !== 'string' || !b.name.trim()) errors.push('name is required');
  if (!b.address || typeof b.address !== 'string' || !b.address.trim())
    errors.push('address is required');
  if (!b.phoneNumber || typeof b.phoneNumber !== 'string' || !b.phoneNumber.trim())
    errors.push('phoneNumber is required');
  if (typeof b.latitude !== 'number' || b.latitude < -90 || b.latitude > 90)
    errors.push('latitude must be a number between -90 and 90');
  if (typeof b.longitude !== 'number' || b.longitude < -180 || b.longitude > 180)
    errors.push('longitude must be a number between -180 and 180');
  if (!isValidClinicType(b.type)) errors.push(`type must be one of: ${VALID_TYPES.join(', ')}`);

  return { valid: errors.length === 0, errors };
}

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

/**
 * GET /clinics
 *
 * Query params:
 *   type      — filter by ClinicType (general | emergency | specialist | pharmacy)
 *   lat       — user latitude (float)
 *   lon       — user longitude (float)
 *   radius    — search radius in km (float, default 50)
 *   available24h — "true" to return only 24h clinics
 */
router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, lat, lon, radius, available24h } = _req.query as Record<string, string>;

    let results = [...clinicStore];

    // Filter by type
    if (type) {
      if (!isValidClinicType(type)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TYPE',
            message: `type must be one of: ${VALID_TYPES.join(', ')}`,
          },
        });
        return;
      }
      results = results.filter((c) => c.type === type);
    }

    // Filter by 24h availability
    if (available24h === 'true') {
      results = results.filter((c) => c.available24h);
    }

    // Filter by radius if lat/lon provided
    if (lat !== undefined && lon !== undefined) {
      const userLat = parseFloat(lat);
      const userLon = parseFloat(lon);
      const radiusKm = radius !== undefined ? parseFloat(radius) : 50;

      if (Number.isNaN(userLat) || Number.isNaN(userLon)) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_COORDS', message: 'lat and lon must be valid numbers' },
        });
        return;
      }

      results = results
        .map((c) => ({
          ...c,
          distance: haversineKm(userLat, userLon, c.latitude, c.longitude),
        }))
        .filter((c) => c.distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance);
    }

    res.json({
      success: true,
      data: results,
      total: results.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /clinics/:id
 */
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinic = clinicStore.find((c) => c.id === req.params.id);
    if (!clinic) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Clinic not found' },
      });
      return;
    }
    res.json({ success: true, data: clinic, timestamp: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /clinics
 * Create a new clinic entry (admin use).
 */
router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { valid, errors } = validateCreateInput(req.body);
    if (!valid) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: errors.join('; ') },
      });
      return;
    }

    const input = req.body as CreateClinicInput;
    const clinic: VetClinic = {
      id: generateId(),
      name: input.name.trim(),
      address: input.address.trim(),
      phoneNumber: input.phoneNumber.trim(),
      latitude: input.latitude,
      longitude: input.longitude,
      type: input.type,
      available24h: input.available24h ?? false,
      rating: input.rating,
      updatedAt: new Date().toISOString(),
    };

    clinicStore.push(clinic);

    res.status(201).json({
      success: true,
      data: clinic,
      message: 'Clinic created successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /clinics/:id
 * Update an existing clinic (admin use).
 */
router.put('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const idx = clinicStore.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Clinic not found' },
      });
      return;
    }

    const input = req.body as UpdateClinicInput;

    // Validate type if provided
    if (input.type !== undefined && !isValidClinicType(input.type)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_TYPE', message: `type must be one of: ${VALID_TYPES.join(', ')}` },
      });
      return;
    }

    // Validate coordinates if provided
    if (input.latitude !== undefined && (input.latitude < -90 || input.latitude > 90)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_COORDS', message: 'latitude must be between -90 and 90' },
      });
      return;
    }
    if (input.longitude !== undefined && (input.longitude < -180 || input.longitude > 180)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_COORDS', message: 'longitude must be between -180 and 180' },
      });
      return;
    }

    clinicStore[idx] = {
      ...clinicStore[idx],
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.address !== undefined && { address: input.address.trim() }),
      ...(input.phoneNumber !== undefined && { phoneNumber: input.phoneNumber.trim() }),
      ...(input.latitude !== undefined && { latitude: input.latitude }),
      ...(input.longitude !== undefined && { longitude: input.longitude }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.available24h !== undefined && { available24h: input.available24h }),
      ...(input.rating !== undefined && { rating: input.rating }),
      updatedAt: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: clinicStore[idx],
      message: 'Clinic updated successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /clinics/:id
 * Remove a clinic (admin use).
 */
router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const idx = clinicStore.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Clinic not found' },
      });
      return;
    }

    clinicStore.splice(idx, 1);

    res.json({
      success: true,
      message: 'Clinic deleted successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
