import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import {
  vetProfileCacheMiddleware,
  vetDirectoryCacheMiddleware,
} from '../../middleware/cacheMiddleware';
import {
  getConversationId,
  getMessages,
  markRead,
  saveMessage,
} from '../../services/messagingService';
import { ok, sendError } from '../response';

const router = express.Router();
router.use(authenticateJWT);

// ─── In-memory vet profile store (replace with PostGIS DB queries) ────────────
interface VetProfile {
  id: string;
  userId: string;
  name: string;
  specialty: string;
  credentials: string;
  acceptedInsurance: string[];
  rating: number;
  reviewCount: number;
  available: boolean;
  lat: number;
  lng: number;
  address: string;
  phone: string;
}

const vetProfiles = new Map<string, VetProfile>();

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
  const specialty = q.specialty?.toLowerCase();
  const available = q.available === 'true' ? true : q.available === 'false' ? false : null;

  let results = [...vetProfiles.values()];

  if (specialty) results = results.filter((v) => v.specialty.toLowerCase().includes(specialty));
  if (available !== null) results = results.filter((v) => v.available === available);

  if (lat !== null && lng !== null) {
    results = results
      .map((v) => ({ ...v, distance: haversineKm(lat, lng, v.lat, v.lng) }))
      .filter((v) => v.distance <= radius)
      .sort((a, b) => a.distance - b.distance);
  }

  return res.json(ok(results));
});

// GET /api/vets/:id
router.get('/:id', vetProfileCacheMiddleware(), (req: AuthenticatedRequest, res) => {
  const vet = vetProfiles.get(req.params.id);
  if (!vet) return sendError(res, 404, 'NOT_FOUND', 'Vet not found');
  return res.json(ok(vet));
});

// POST /api/vets (vet self-registration)
router.post('/', (req: AuthenticatedRequest, res) => {
  const { specialty, credentials, acceptedInsurance, lat, lng, address, phone, name } =
    req.body as Partial<VetProfile>;
  if (!lat || !lng || !specialty) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'lat, lng, and specialty are required');
  }
  const profile: VetProfile = {
    id: uuidv4(),
    userId: req.user!.id,
    name: name ?? req.user!.email,
    specialty,
    credentials: credentials ?? '',
    acceptedInsurance: acceptedInsurance ?? [],
    rating: 0,
    reviewCount: 0,
    available: true,
    lat,
    lng,
    address: address ?? '',
    phone: phone ?? '',
  };
  vetProfiles.set(profile.id, profile);
  return res.status(201).json(ok(profile));
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
