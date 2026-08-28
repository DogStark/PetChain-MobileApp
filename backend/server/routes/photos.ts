/**
 * Photo routes — /api/photos
 *
 * Handles pet photo uploads, listing, retrieval, and deletion.
 * Integrates with cdnService for signed URL generation, thumbnail
 * creation, and CDN cache invalidation on deletion.
 */

import { randomUUID } from 'crypto';

import express from 'express';
import multer from 'multer';

import type { AuditableRequest } from '../../middleware/auditLog';
import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import cdnService from '../../services/cdnService';
import { ok, sendError } from '../response';
import { store } from '../store';

const router = express.Router();

// ---- Multer: in-memory storage so we can inspect the buffer before upload --
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB — client should compress before sending
    files: 1,
  },
  fileFilter(_req, file, cb) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(new Error('Only JPEG, PNG, and WebP images are accepted'));
      return;
    }
    cb(null, true);
  },
});

// ---- In-memory photo store (mirrors the pattern used by store.ts) ----------
interface StoredPetPhoto {
  id: string;
  petId: string;
  caption?: string;
  url: string;
  thumbnailUrl: string;
  key: string;
  thumbnailKey: string;
  sizeBytes: number;
  width: number;
  height: number;
  uploadedAt: string;
  uploadedById: string;
}

const photos = new Map<string, StoredPetPhoto>();

// ---- All photo routes require authentication --------------------------------
router.use(authenticateJWT);

// ---- POST /api/photos — upload a new photo ---------------------------------
router.post('/', upload.single('photo'), async (req: AuthenticatedRequest, res) => {
  const file = req.file;
  if (!file) {
    return sendError(res, 400, 'MISSING_FILE', 'A photo file is required');
  }

  const { petId, caption, width, height } = req.body as {
    petId?: string;
    caption?: string;
    width?: string;
    height?: string;
  };

  if (!petId) {
    return sendError(res, 400, 'MISSING_FIELD', 'petId is required');
  }

  const pet = store.pets.get(petId);
  if (!pet) {
    return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  }

  // Only the pet's owner (or an admin) may upload photos
  const userId = req.user!.id;
  if (pet.ownerId !== userId) {
    return sendError(res, 403, 'FORBIDDEN', 'Only the pet owner may upload photos');
  }

  try {
    const photoId = randomUUID();
    const result = await cdnService.uploadPhoto(photoId, petId, file.buffer, file.mimetype);

    const stored: StoredPetPhoto = {
      id: photoId,
      petId,
      caption: caption?.trim() || undefined,
      url: result.url,
      thumbnailUrl: result.thumbnailUrl,
      key: result.key,
      thumbnailKey: result.thumbnailKey,
      sizeBytes: result.sizeBytes,
      width: Number(width) || 0,
      height: Number(height) || 0,
      uploadedAt: new Date().toISOString(),
      uploadedById: userId,
    };

    photos.set(photoId, stored);

    (req as AuditableRequest).audit?.('photo.uploaded', 'pet', petId, { photoId });

    return res.status(201).json(ok({ photo: toResponse(stored) }));
  } catch (err) {
    console.error('[photos] Upload failed:', err);
    return sendError(res, 500, 'UPLOAD_FAILED', 'Photo upload failed');
  }
});

// ---- GET /api/photos/pet/:petId — list photos for a pet --------------------
router.get('/pet/:petId', (req: AuthenticatedRequest, res) => {
  const { petId } = req.params as { petId: string };

  const pet = store.pets.get(petId);
  if (!pet) {
    return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  }

  if (pet.ownerId !== req.user!.id) {
    return sendError(res, 403, 'FORBIDDEN', 'Only the pet owner may view photos');
  }

  const list = [...photos.values()]
    .filter((p) => p.petId === petId)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    .map(toResponse);

  return res.json(ok(list));
});

// ---- GET /api/photos/:photoId — single photo with signed URL ---------------
router.get('/:photoId', (req: AuthenticatedRequest, res) => {
  const { photoId } = req.params as { photoId: string };

  const photo = photos.get(photoId);
  if (!photo) {
    return sendError(res, 404, 'NOT_FOUND', 'Photo not found');
  }

  const pet = store.pets.get(photo.petId);
  if (!pet || pet.ownerId !== req.user!.id) {
    return sendError(res, 403, 'FORBIDDEN', 'Access denied');
  }

  const signedUrl = cdnService.generateSignedUrl(photo.key);
  const signedThumbUrl = cdnService.generateSignedUrl(photo.thumbnailKey);

  return res.json(
    ok({
      ...toResponse(photo),
      signedUrl,
      signedThumbnailUrl: signedThumbUrl,
    }),
  );
});

// ---- DELETE /api/photos/:photoId — delete photo and invalidate CDN cache ---
router.delete('/:photoId', async (req: AuthenticatedRequest, res) => {
  const { photoId } = req.params as { photoId: string };

  const photo = photos.get(photoId);
  if (!photo) {
    return sendError(res, 404, 'NOT_FOUND', 'Photo not found');
  }

  const pet = store.pets.get(photo.petId);
  if (!pet || pet.ownerId !== req.user!.id) {
    return sendError(res, 403, 'FORBIDDEN', 'Only the pet owner may delete photos');
  }

  try {
    await cdnService.deletePhoto(photo.key, photo.thumbnailKey);
    photos.delete(photoId);

    (req as AuditableRequest).audit?.('photo.deleted', 'pet', photo.petId, { photoId });

    return res.json(ok({ deleted: true }));
  } catch (err) {
    console.error('[photos] Delete failed:', err);
    return sendError(res, 500, 'DELETE_FAILED', 'Photo deletion failed');
  }
});

// ---- Helper ----------------------------------------------------------------
function toResponse(p: StoredPetPhoto) {
  return {
    id: p.id,
    petId: p.petId,
    caption: p.caption,
    url: p.url,
    thumbnailUrl: p.thumbnailUrl,
    sizeBytes: p.sizeBytes,
    width: p.width,
    height: p.height,
    uploadedAt: p.uploadedAt,
    uploadedById: p.uploadedById,
  };
}

export default router;
