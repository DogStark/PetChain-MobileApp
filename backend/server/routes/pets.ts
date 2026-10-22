/* eslint-disable @typescript-eslint/no-non-null-assertion */
import crypto from 'crypto';
import { randomUUID } from 'crypto';

import express from 'express';

import { logAuditTrail } from '../../middleware/auditLogger';
import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import {
  petProfileCacheMiddleware,
  petsByOwnerCacheMiddleware,
} from '../../middleware/cacheMiddleware';
import { UserRole } from '../../models/UserRole';
import { invalidatePet } from '../../services/cacheService';
import paymentService from '../../services/paymentService';
import { issuePetAsset, transferPetAsset } from '../../services/stellarAssetService';
import { petRepository } from '../../src/repositories/petRepository';
import { type DBPet } from '../../src/repositories/petRepository';
import { userRepository } from '../../src/repositories/userRepository';
import { ok, sendError } from '../response';
import { type StoredMedicalRecord, type StoredPet, store } from '../store';

const router = express.Router();
const QR_SECRET = process.env.QR_SIGNING_SECRET ?? 'petchain-dev-qr-secret';
const ALLERGY_CORRECTION_STATUSES = ['pending', 'approved', 'rejected'] as const;
type AllergyCorrectionStatus = (typeof ALLERGY_CORRECTION_STATUSES)[number];

function signPetIdentity(petId: string, issuedAt: string): string {
  return crypto.createHmac('sha256', QR_SECRET).update(`${petId}:${issuedAt}`).digest('hex');
}

function activeQrForPet(petId: string) {
  return [...store.petQrIdentities.values()]
    .filter((row) => row.petId === petId && !row.revokedAt)
    .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())[0];
}

function emergencyPetView(pet: StoredPet | DBPet) {
  const row = 'owner_id' in pet ? undefined : pet;
  return {
    id: pet.id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed,
    weightKg: 'weight_kg' in pet ? pet.weight_kg : row?.weightKg,
    microchipId: 'microchip_id' in pet ? pet.microchip_id : row?.microchipId,
    photoUrl: 'photo_url' in pet ? pet.photo_url : row?.photoUrl,
    emergencyNotes: [...store.medicalRecords.values()]
      .filter((record) => record.petId === pet.id)
      .sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime())
      .slice(0, 3)
      .map((record) => ({
        type: mapMobileRecordType(record.type),
        date: record.visitDate,
        notes: record.notes ?? record.diagnosis ?? '',
      })),
  };
}

async function ownerSummary(ownerId: string) {
  const u = await userRepository.findById(ownerId);
  if (!u) return undefined;
  return { id: u.id, name: u.name, email: u.email };
}

async function toPetResponse(p: StoredPet | DBPet) {
  const ownerId = ('owner_id' in p ? p.owner_id : p.ownerId) as string;
  return {
    id: p.id,
    name: p.name,
    species: p.species,
    breed: p.breed,
    dateOfBirth: 'date_of_birth' in p ? p.date_of_birth : (p as StoredPet).dateOfBirth,
    weightKg: 'weight_kg' in p ? p.weight_kg : (p as StoredPet).weightKg,
    microchipId: 'microchip_id' in p ? p.microchip_id : (p as StoredPet).microchipId,
    photoUrl: 'photo_url' in p ? p.photo_url : (p as StoredPet).photoUrl,
    thumbnailUrl: 'thumbnail_url' in p ? p.thumbnail_url : (p as StoredPet).thumbnailUrl,
    ownerId,
    createdAt: 'created_at' in p ? p.created_at : (p as StoredPet).createdAt,
    updatedAt: 'updated_at' in p ? p.updated_at : (p as StoredPet).updatedAt,
    owner: await ownerSummary(ownerId),
    metadata: (p as StoredPet).metadata ?? {},
  };
}

function mapMobileRecordType(t: string): 'vaccination' |'treatment' | 'diagnosis' {
  if (t === 'vaccination') return 'vaccination';
  if (t === 'treatment') return 'treatment';
  return 'diagnosis';
}

function medicalToMobileRow(r: StoredMedicalRecord) {
  return {
    id: r.id,
    petId: r.petId,
    type: mapMobileRecordType(r.type),
    date: r.visitDate,
    veterinarian: store.users.get(r.vetId)?.name ?? r.vetId,
    notes: r.notes ?? r.diagnosis ?? '',
    createdAt: r.createdAt,
  };
}

type StoredAllergyEntry = {
  id: string;
  petId: string;
  allergen: string;
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe';
  onsetDate: string;
  source: 'owner' | 'vet' | 'import';
  verificationStatus: 'unverified' | 'verified' | 'disputed';
  verifiedBy?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

type StoredAllergyCorrection = {
  id: string;
  petId: string;
  allergyId: string;
  requestedBy: string;
  reason: string;
  proposed?: Partial<Pick<StoredAllergyEntry, 'allergen' | 'reaction' | 'severity' | 'onsetDate'>>;
  status: AllergyCorrectionStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
};

const allergyEntries = new Map<string, StoredAllergyEntry>();
const allergyCorrections = new Map<string, StoredAllergyCorrection>();

function canAccessPet(user: AuthenticatedRequest['user'], pet: StoredPet): boolean {
  if (!user) return false;
  if (user.role === UserRole.ADMIN || user.role === UserRole.VET) return true;
  return user.id === pet.ownerId;
}

function canVerifyAllergy(user: AuthenticatedRequest['user']): boolean {
  return !!user && (user.role === UserRole.ADMIN || user.role === UserRole.VET);
}

router.get('identity/:token', async (req, res) => {
  const identity = store.petQrIdentities.get(req.params.token);
  if (!identity || identity.revokedAt) {
    return sendError(res, 404, 'QR_NOT_FOUND', 'This pet identity code is invalid or expired');
  }
  const pet = (await petRepository.findById(identity.petId)) || store.pets.get(identity.petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  return res.json(ok({ pet: emergencyPetView(pet), issuedAt: identity.issuedAt }));
});

router.get('identity/:token/view', async (req, res) => {
  const identity = store.petQrIdentities.get(req.params.token);
  if (!identity || identity.revokedAt) {
    return res.status(404).send('<h1>Pet identity code unavailable</h1>');
  }
  const pet = (await petRepository.findById(identity.petId)) || store.pets.get(identity.petId);
  if (!pet) return res.status(404).send('<h1>Pet not found</h1>');
  const view = emergencyPetView(pet);
  return res.type('html').send(`
    <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${view.name} Emergency Profile</title></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#f6fbf7;color:#16301f">
      <main style="max-width:680px;margin:0 auto;padding:24px">
        <section style="background:white;border-radius:20px;padding:24px;box-shadow:0 12px 40px rgba(0,0,0,.08)">
          <h1 style="margin-top:0">${view.name}</h1>
          <p><strong>Species:</strong> ${view.species}</p>
          ${view.breed ? `<p><strong>Breed:</strong> ${view.breed}</p>` : ''}
          ${view.microchipId ? `<p><strong>Microchip:</strong> ${view.microchipId}</p>` : ''}
          <h2>Recent critical notes</h2>
          ${
            view.emergencyNotes.length
              ? view.emergencyNotes
                  .map(
                    (note) =>
                      `<p><strong>${note.type}</strong> (${note.date})<br>${note.notes}</p>`,
                  )
                  .join('')
              : '<p>No emergency notes available.</p>'
          }
        </section>
      </main>
    </body></html>
  `);
});

// All routes below require authentication
router.use(authenticateJWT);

router.get('/owner/:ownerId', petsByOwnerCacheMiddleware(), (req: AuthenticatedRequest, res) => {
  // Only admin or the owner themselves can see their pets
  if (req.user!.role !== UserRole.ADMIN && req.user!.id !== req.params.ownerId) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to view these pets');
  }

  const list = [...store.pets.values()]
    .filter((p) => p.ownerId === req.params.ownerId)
    .map(toPetResponse);
  return res.json(ok(list));
});

router.get('/qr/:qrCode', async (req, res) => {
  const raw = decodeURIComponent(req.params.qrCode);
  let pet = await petRepository.findById(raw);
  if (!pet && raw.includes('pet/')) {
    const tail = raw.split('pet/').pop()?.trim();
    if (tail) {
      pet =
        (await petRepository.findById(tail)) ||
        (await petRepository.findById(decodeURIComponent(tail)));
    }
  }
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found for QR code');
  return res.json(ok(await toPetResponse(pet)));
});

router.post('/:id/qr-identity', (req: AuthenticatedRequest, res) => {
  const pet = store.pets.get(req.params.id);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  if (req.user!.role !== UserRole.ADMIN && req.user!.id !== pet.ownerId) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to generate this code');
  }
  const previous = activeQrForPet(pet.id);
  if (previous) {
    store.petQrIdentities.set(previous.token, { ...previous, revokedAt: new Date().toISOString() });
  }
  const issuedAt = new Date().toISOString();
  const token = `${pet.id}.${issuedAt}.${signPetIdentity(pet.id, issuedAt)}`;
  const row = { petId: pet.id, token, issuedAt };
  store.petQrIdentities.set(token, row);
  return res.status(201).json(
    ok({
      token,
      url: `https://petchain.app/pets/identity/${encodeURIComponent(token)}/view`,
      deepLink: `petchain://pet/${encodeURIComponent(pet.id)}`,
      issuedAt,
    }),
  );
});

router.get('/:petId/medical-records', (req: AuthenticatedRequest, res) => {
  const { petId } = req.params;
  const pet = store.pets.get(petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');

  // Only admin, vet, or the owner can see medical records
  if (req.user!.role === UserRole.OWNER && req.user!.id !== pet.ownerId) {
    return sendError(
      res,
      403,
      'FORBIDDEN',
      'You do not have permission to view these medical records',
    );
  }

  const q = req.query as Record<string | undefined>;
  const type = q.type;
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));

  let rows = [...store.medicalRecords.values()].filter((r) => r.petId === petId);
  if (type) rows = rows.filter((r) => r.type === type);
  rows.sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime());
  const total = rows.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  const slice = rows.slice(start, start + limit).map(medicalToMobileRow);

  return res.json({
    data: slice,
    total,
    page,
    limit,
    totalPages,
  });
});

router.get('/:petId/allergies', (req: AuthenticatedRequest, res) => {
  const { petId } = req.params;
  const pet = store.pets.get(petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  if (!canAccessPet(req.user, pet)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to view these allergies');
  }

  const q = req.query as Record<string | undefined>;
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
  const since = q.since ? new Date(q.since) : undefined;
  if (q.since && Number.isNaN(since!.getTime())) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'since must be a valid ISO date');
  }

  let rows = [...allergyEntries.values()].filter((row) => row.petId === petId);
  if (since) rows = rows.filter((row) => new Date(row.onsetDate).getTime() >= since.getTime());
  rows.sort((a, b) => new Date(b.onsetDate).getTime() - new Date(a.onsetDate).getTime());

  const total = rows.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  const slice = rows.slice(start, start + limit);

  return res.json({
    data: slice,
    total,
    page,
    limit,
    totalPages,
    serverTime: new Date().toISOString(),
  });
});

export default router;
