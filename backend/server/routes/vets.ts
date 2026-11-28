import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import {
  vetProfileCacheMiddleware,
  vetDirectoryCacheMiddleware,
} from '../../middleware/cacheMiddleware';
import { UserRole } from '../../models/UserRole';
import {
  getConversationId,
  getMessages,
  markRead,
  saveMessage,
} from '../../services/messagingService';
import {
  createVetProfile,
  getVetProfile,
  listVetProfiles,
  updateVetProfile,
  type CreateVetProfileInput,
  type UpdateVetProfileInput,
} from '../../services/vetDirectoryService';
import { ok, sendError } from '../response';

const router = express.Router();
router.use(authenticateJWT);

// Vet profiles live in vetDirectoryService, which geocodes addresses (#1396).

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GET /api/vets?lat=&lng=&radius=&specialty=&available=
router.get('/', vetDirectoryCacheMiddleware(), (req: AuthenticatedRequest, res) => {
  const q = req.query as Record<string, string | undefined>;
  const lat = q.lat ? parseFloat(q.lat) : null;
  const lng = q.lng ? parseFloat(q.lng) : null;
  const radius = q.radius ? parseFloat(q.radius) : 25;
  if (
    (lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) ||
    (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180)) ||
    !Number.isFinite(radius) ||
    radius <= 0
  ) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'lat, lng and radius must be valid numbers');
  }
  const specialty = q.specialty?.toLowerCase();
  const available = q.available === 'true' ? true : q.available === 'false' ? false : null;

  let results = listVetProfiles();

  if (specialty) results = results.filter((v) => v.specialty.toLowerCase().includes(specialty));
  if (available !== null) results = results.filter((v) => v.available === available);

  if (lat !== null && lng !== null) {
    // Proximity search only includes clinics with geocoded coordinates.
    results = results
      .filter((v) => v.lat !== null && v.lng !== null)
      .map((v) => ({ ...v, distance: haversineKm(lat, lng, v.lat!, v.lng!) }))
      .filter((v) => v.distance <= radius)
      .sort((a, b) => a.distance - b.distance);
  }

  return res.json(ok(results));
});

// GET /api/vets/:id
router.get('/:id', vetProfileCacheMiddleware(), (req: AuthenticatedRequest, res) => {
  const vet = getVetProfile(req.params.id);
  if (!vet) return sendError(res, 404, 'NOT_FOUND', 'Vet not found');
  return res.json(ok(vet));
});

// POST /api/vets (vet self-registration) — the address is geocoded to lat/lng.
router.post('/', async (req: AuthenticatedRequest, res) => {
  const body = req.body as CreateVetProfileInput;
  const hasCoords = typeof body.lat === 'number' && typeof body.lng === 'number';
  if (!body.specialty || (!body.address?.trim() && !hasCoords)) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'specialty and an address (or lat and lng) are required',
    );
  }
  const profile = await createVetProfile(req.user!.id, req.user!.email, body);
  return res.status(201).json(ok(profile));
});

// PUT /api/vets/:id — updates a clinic; a changed address is re-geocoded.
router.put('/:id', async (req: AuthenticatedRequest, res) => {
  const existing = getVetProfile(req.params.id);
  if (!existing) return sendError(res, 404, 'NOT_FOUND', 'Vet not found');
  if (existing.userId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
    return sendError(res, 403, 'FORBIDDEN', 'You can only update your own clinic profile');
  }
  const { name, specialty, credentials, acceptedInsurance, address, phone, available } =
    req.body as UpdateVetProfileInput;
  const updated = await updateVetProfile(req.params.id, {
    ...(name !== undefined ? { name } : {}),
    ...(specialty !== undefined ? { specialty } : {}),
    ...(credentials !== undefined ? { credentials } : {}),
    ...(acceptedInsurance !== undefined ? { acceptedInsurance } : {}),
    ...(address !== undefined ? { address } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(available !== undefined ? { available } : {}),
  });
  return res.json(ok(updated));
});

// ─── Messaging ────────────────────────────────────────────────────────────────

// GET /api/vets/messages/:vetId?before=&limit=
router.get('/messages/:vetId', (req: AuthenticatedRequest, res) => {
  const conversationId = getConversationId(req.user!.id, req.params.vetId);
  const q = req.query as Record<string, string | undefined>;
  const msgs = getMessages(conversationId, q.limit ? parseInt(q.limit) : 50, q.before);
  markRead(conversationId, req.user!.id);
  return res.json(ok(msgs));
});

// POST /api/vets/messages/:vetId
router.post('/messages/:vetId', (req: AuthenticatedRequest, res) => {
  const { content, attachmentUrl, attachmentType } = req.body as {
    content?: string;
    attachmentUrl?: string;
    attachmentType?: string;
  };
  if (!content && !attachmentUrl) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'content or attachmentUrl required');
  }
  const conversationId = getConversationId(req.user!.id, req.params.vetId);
  const msg = saveMessage({
    conversationId,
    senderId: req.user!.id,
    recipientId: req.params.vetId,
    content,
    attachmentUrl,
    attachmentType,
  });
  return res.status(201).json(ok(msg));
});

export default router;
