/* eslint-disable @typescript-eslint/no-non-null-assertion */
import crypto from 'crypto';

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

function mapMobileRecordType(t: string): 'vaccination' | 'treatment' | 'diagnosis' {
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

router.get('/identity/:token', async (req, res) => {
  const identity = store.petQrIdentities.get(req.params.token);
  if (!identity || identity.revokedAt) {
    return sendError(res, 404, 'QR_NOT_FOUND', 'This pet identity code is invalid or expired');
  }
  const pet = (await petRepository.findById(identity.petId)) || store.pets.get(identity.petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  return res.json(ok({ pet: emergencyPetView(pet), issuedAt: identity.issuedAt }));
});

router.get('/identity/:token/view', async (req, res) => {
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

  const q = req.query as Record<string, string | undefined>;
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

router.get('/', petsByOwnerCacheMiddleware(), (req: AuthenticatedRequest, res) => {
  const ownerId = (req.query as Record<string, string | undefined>).ownerId;

  // If ownerId is provided, filter. Otherwise, only admin/vet can see all pets.
  if (!ownerId && req.user!.role === UserRole.OWNER) {
    return sendError(res, 403, 'FORBIDDEN', 'OwnerId parameter is required for pet owners');
  }

  if (ownerId && req.user!.role === UserRole.OWNER && req.user!.id !== ownerId) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to view these pets');
  }

  let list = [...store.pets.values()];
  if (ownerId) list = list.filter((p) => p.ownerId === ownerId);
  return res.json(ok(list.map(toPetResponse)));
});

router.get('/:id', petProfileCacheMiddleware(), (req: AuthenticatedRequest, res) => {
  const pet = store.pets.get(req.params.id);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');

  // Only admin, vet, or owner can see pet details
  if (req.user!.role === UserRole.OWNER && req.user!.id !== pet.ownerId) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to view this pet');
  }

  return res.json(ok(toPetResponse(pet)));
});

router.post('/', async (req: AuthenticatedRequest, res) => {
  const {
    name,
    species,
    breed,
    dateOfBirth,
    weightKg,
    microchipId,
    photoUrl,
    thumbnailUrl,
    ownerId,
  } = req.body as Partial<StoredPet & { thumbnailUrl?: string }>;
  if (!name?.trim() || !species?.trim() || !ownerId?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name, species, and ownerId are required');
  }

  // Only admin or the owner themselves can create a pet for that owner
  if (req.user!.role !== UserRole.ADMIN && req.user!.id !== ownerId) {
    return sendError(
      res,
      403,
      'FORBIDDEN',
      'You do not have permission to create a pet for this owner',
    );
  }

  // Enforce free-tier pet limit (1 pet)
  const activeSub = paymentService.getSubscription(ownerId.trim());
  const isPremium = activeSub?.status === 'active' && activeSub.plan !== 'free';
  if (!isPremium && req.user!.role !== UserRole.ADMIN) {
    const existingPets = [...store.pets.values()].filter((p) => p.ownerId === ownerId.trim());
    if (existingPets.length >= 1) {
      return sendError(
        res,
        403,
        'SUBSCRIPTION_REQUIRED',
        'Free tier allows 1 pet. Upgrade to Premium for unlimited pets.',
      );
    }
  }

  if (!store.users.get(ownerId.trim())) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'ownerId must reference an existing user');
  }

  const id = store.newId();
  const pet = await petRepository.create({
    id,
    name: name.trim(),
    species: species.trim(),
    breed: breed?.trim(),
    date_of_birth: dateOfBirth ? new Date(dateOfBirth) : undefined,
    weight_kg: typeof weightKg === 'number' ? weightKg : undefined,
    microchip_id: microchipId?.trim(),
    photo_url: photoUrl?.trim(),
    thumbnail_url: thumbnailUrl?.trim(),
    owner_id: ownerId.trim(),
  });

  void logAuditTrail({
    req,
    entityType: 'pet',
    entityId: pet.id,
    action: 'CREATE',
    before: null,
    after: await toPetResponse(pet),
  });

  await invalidatePet(pet.id, pet.owner_id);

  // Issue Stellar pet identity NFT
  try {
    const sourceSeed = process.env.STELLAR_SOURCE_SEED;
    const issuerSeed = process.env.STELLAR_ISSUER_SEED;
    if (sourceSeed && issuerSeed) {
      await issuePetAsset(pet.id, sourceSeed, issuerSeed);
    }
  } catch (err) {
    console.error('[Stellar] Failed to issue pet asset:', err);
  }
  return res.status(201).json(ok(await toPetResponse(pet), 'Pet created'));
});

router.put('/:id', async (req: AuthenticatedRequest, res) => {
  const pet = store.pets.get(req.params.id);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');

  // Only admin or the owner can update the pet
  if (req.user!.role !== UserRole.ADMIN && req.user!.id !== pet.ownerId) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to update this pet');
  }

  const body = req.body as Partial<StoredPet>;
  const t = new Date().toISOString();
  const next: StoredPet = {
    ...pet,
    ...(body.name !== undefined ? { name: String(body.name) } : {}),
    ...(body.species !== undefined ? { species: String(body.species) } : {}),
    ...(body.breed !== undefined ? { breed: body.breed ? String(body.breed) : undefined } : {}),
    ...(body.dateOfBirth !== undefined
      ? { dateOfBirth: body.dateOfBirth ? String(body.dateOfBirth) : undefined }
      : {}),
    ...(body.weightKg !== undefined ? { weightKg: body.weightKg } : {}),
    ...(body.microchipId !== undefined
      ? { microchipId: body.microchipId ? String(body.microchipId) : undefined }
      : {}),
    ...(body.photoUrl !== undefined
      ? { photoUrl: body.photoUrl ? String(body.photoUrl) : undefined }
      : {}),
    ...(body.thumbnailUrl !== undefined
      ? { thumbnailUrl: body.thumbnailUrl ? String(body.thumbnailUrl) : undefined }
      : {}),
    // Only admin can change owner
    ...(body.ownerId !== undefined && req.user!.role === UserRole.ADMIN
      ? { ownerId: String(body.ownerId) }
      : {}),
    // Allow owners to update pet metadata (step goals, custom config)
    ...(body.metadata !== undefined
      ? { metadata: { ...(pet.metadata ?? {}), ...body.metadata } }
      : {}),
    updatedAt: t,
  };
  if (
    body.ownerId !== undefined &&
    req.user!.role === UserRole.ADMIN &&
    String(body.ownerId) !== pet.ownerId
  ) {
    const previous = activeQrForPet(pet.id);
    if (previous) store.petQrIdentities.set(previous.token, { ...previous, revokedAt: t });

    // Transfer Stellar pet identity NFT to new owner
    try {
      const assetCode = `PET${pet.id.substring(0, 9).toUpperCase()}`;
      const issuerPublicKey = process.env.STELLAR_ISSUER_PUBLIC_KEY;
      const currentOwnerSeed = process.env.STELLAR_SOURCE_SEED;
      const newOwnerUser = await userRepository.findById(body.ownerId);
      const newOwnerPublicKey = newOwnerUser?.stellar_public_key;

      if (issuerPublicKey && currentOwnerSeed && newOwnerPublicKey) {
        await transferPetAsset(assetCode, issuerPublicKey, currentOwnerSeed, newOwnerPublicKey);
      }
    } catch (err) {
      console.error('[Stellar] Failed to transfer pet asset:', err);
    }
  }
  store.pets.set(pet.id, next);
  void logAuditTrail({
    req,
    entityType: 'pet',
    entityId: pet.id,
    action: 'UPDATE',
    before: pet,
    after: next,
  });
  return res.json(ok(await toPetResponse(next), 'Pet updated'));
});

router.delete('/:id', (req: AuthenticatedRequest, res) => {
  const pet = store.pets.get(req.params.id);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');

  // Only admin or the owner can delete the pet
  if (req.user!.role !== UserRole.ADMIN && req.user!.id !== pet.ownerId) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to delete this pet');
  }

  store.pets.delete(req.params.id);
  for (const u of store.users.values()) {
    u.pets = u.pets.filter((p) => p.id !== req.params.id);
  }
  void logAuditTrail({
    req,
    entityType: 'pet',
    entityId: pet.id,
    action: 'DELETE',
    before: pet,
    after: null,
  });
  return res.json(ok(null, 'Pet deleted'));
});

export default router;
