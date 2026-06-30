/**
 * v2 /pets — breaking changes vs v1:
 *   - `owner` field renamed to `ownerInfo`
 *   - `dateOfBirth` renamed to `birthDate`
 *   - list endpoint returns `{ data, total, page, limit }` envelope (was flat array)
 *   - DELETE returns 204 No Content (was 200 JSON)
 */
import express from 'express';

import { ok, sendError } from '../../../server/response';
import { store, type StoredPet } from '../../../server/store';

const router = express.Router();

function ownerInfo(ownerId: string) {
  const u = store.users.get(ownerId);
  if (!u) return undefined;
  return { id: u.id, name: u.name, email: u.email };
}

function toV2Pet(p: StoredPet) {
  const { dateOfBirth, ...rest } = p;
  return {
    ...rest,
    birthDate: dateOfBirth, // renamed field
    ownerInfo: ownerInfo(p.ownerId), // renamed from `owner`
    metadata: p.metadata ?? {},
  };
}

router.get('/', (req, res) => {
  const ownerId = req.query.ownerId as string | undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  let list = [...store.pets.values()];
  if (ownerId) list = list.filter((p) => p.ownerId === ownerId);

  const total = list.length;
  const slice = list.slice((page - 1) * limit, page * limit).map(toV2Pet);

  return res.json(ok({ data: slice, total, page, limit }));
});

router.get('/:id', (req, res) => {
  const pet = store.pets.get(req.params.id);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  return res.json(ok(toV2Pet(pet)));
});

router.post('/', (req, res) => {
  const { name, species, breed, birthDate, microchipId, photoUrl, ownerId } = req.body as Partial<
    StoredPet & { birthDate?: string }
  >;
  if (!name?.trim() || !species?.trim() || !ownerId?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name, species, and ownerId are required');
  }
  if (!store.users.get(ownerId.trim())) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'ownerId must reference an existing user');
  }
  const t = new Date().toISOString();
  const id = store.newId();
  const row: StoredPet = {
    id,
    name: name.trim(),
    species: species.trim(),
    breed: breed?.trim(),
    dateOfBirth: birthDate?.trim(), // stored under original key
    microchipId: microchipId?.trim(),
    photoUrl: photoUrl?.trim(),
    ownerId: ownerId.trim(),
    createdAt: t,
    updatedAt: t,
  };
  store.pets.set(id, row);
  const owner = store.users.get(row.ownerId);
  if (owner) {
    owner.pets = [...owner.pets.filter((p) => p.id !== id), { id, name: row.name }];
    owner.updatedAt = t;
  }
  return res.status(201).json(ok(toV2Pet(row), 'Pet created'));
});

router.put('/:id', (req, res) => {
  const pet = store.pets.get(req.params.id);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  const b = req.body as Partial<StoredPet & { birthDate?: string }>;
  const t = new Date().toISOString();
  const next: StoredPet = {
    ...pet,
    ...(b.name !== undefined ? { name: String(b.name) } : {}),
    ...(b.species !== undefined ? { species: String(b.species) } : {}),
    ...(b.breed !== undefined ? { breed: b.breed ? String(b.breed) : undefined } : {}),
    ...(b.birthDate !== undefined
      ? { dateOfBirth: b.birthDate ? String(b.birthDate) : undefined }
      : {}),
    ...(b.microchipId !== undefined
      ? { microchipId: b.microchipId ? String(b.microchipId) : undefined }
      : {}),
    ...(b.photoUrl !== undefined ? { photoUrl: b.photoUrl ? String(b.photoUrl) : undefined } : {}),
    ...(b.metadata !== undefined ? { metadata: { ...(pet.metadata ?? {}), ...b.metadata } } : {}),
    updatedAt: t,
  };
  store.pets.set(pet.id, next);
  return res.json(ok(toV2Pet(next), 'Pet updated'));
});

router.delete('/:id', (req, res) => {
  if (!store.pets.delete(req.params.id)) {
    return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  }
  for (const u of store.users.values()) {
    u.pets = u.pets.filter((p) => p.id !== req.params.id);
  }
  return res.status(204).send(); // v2: 204 instead of 200
});

export default router;
