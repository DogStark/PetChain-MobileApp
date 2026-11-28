/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { randomUUID } from 'crypto';

import express from 'express';

import { logAuditTrail } from '../../middleware/auditLogger';
import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { AppointmentStatus } from '../../models/Appointment';
import { UserRole } from '../../models/UserRole';
import { ok, sendError } from '../../server/response';
import { store } from '../../server/store';
import logger from '../../utils/logger';

const router = express.Router();
router.use(authenticateJWT);

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocumentCategory = 'vaccination' | 'insurance' | 'vet_report' | 'other';
export type DocumentReviewStatus = 'pending_review' | 'accepted' | 'rejected' | 'expired';

export interface StoredDocument {
  id: string;
  petId: string;
  ownerId: string;
  name: string;
  category: DocumentCategory;
  mimeType: string;
  sizeBytes: number;
  /** Base64-encoded AES-256 encrypted content — never plaintext */
  encryptedContent: string;
  /** Encryption metadata from client */
  iv: string;
  tag: string;
  keyVersion: number;
  /** Base64 thumbnail (encrypted, image docs only) */
  encryptedThumbnail?: string;
  version: number;
  parentId?: string; // points to first version's id
  deletedAt?: string;
  reviewStatus: DocumentReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Quota limits (bytes) per subscription tier ───────────────────────────────

const QUOTA: Record<string, number> = {
  free: 50 * 1024 * 1024, // 50 MB
  premium: 500 * 1024 * 1024, // 500 MB
  vet: 2 * 1024 * 1024 * 1024, // 2 GB
};
const DEFAULT_QUOTA = QUOTA.free;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB per file

// ─── In-memory store extension ────────────────────────────────────────────────

if (!('documents' in store)) {
  (store as unknown as Record<string, unknown>).documents = new Map<string, StoredDocument>();
}
const docs = (): Map<string, StoredDocument> =>
  (store as unknown as Record<string, Map<string, StoredDocument>>).documents;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ownerQuotaUsed(ownerId: string): number {
  let total = 0;
  for (const d of docs().values()) {
    if (d.ownerId === ownerId && !d.deletedAt) total += d.sizeBytes;
  }
  return total;
}

function ownerQuotaLimit(req: AuthenticatedRequest): number {
  const user = store.users.get(req.user!.id);
  // Extend StoredUser with optional tier field
  const tier = (user as unknown as Record<string, string> | undefined)?.subscriptionTier ?? 'free';
  return QUOTA[tier] ?? DEFAULT_QUOTA;
}

function canAccess(doc: StoredDocument, req: AuthenticatedRequest): boolean {
  if (req.user!.role === UserRole.ADMIN) return true;
  if (req.user!.role === UserRole.VET) return hasAssignedAppointment(doc, req);
  return doc.ownerId === req.user!.id;
}

function hasAssignedAppointment(doc: StoredDocument, req: AuthenticatedRequest): boolean {
  return [...store.appointments.values()].some(
    (appointment) =>
      appointment.petId === doc.petId &&
      appointment.vetId === req.user!.id &&
      (appointment.status === AppointmentStatus.PENDING ||
        appointment.status === AppointmentStatus.CONFIRMED ||
        appointment.status === AppointmentStatus.COMPLETED),
  );
}

function isLatestVersion(doc: StoredDocument): boolean {
  const rootId = doc.parentId ?? doc.id;
  return ![...docs().values()].some(
    (candidate) =>
      (candidate.parentId ?? candidate.id) === rootId && candidate.version > doc.version,
  );
}

function isReviewerFor(doc: StoredDocument, req: AuthenticatedRequest): boolean {
  if (req.user!.role === UserRole.ADMIN) return true;
  if (req.user!.role !== UserRole.VET) return false;
  return hasAssignedAppointment(doc, req);
}

function canReview(doc: StoredDocument, req: AuthenticatedRequest): boolean {
  return (
    !doc.deletedAt &&
    isLatestVersion(doc) &&
    doc.reviewStatus === 'pending_review' &&
    isReviewerFor(doc, req)
  );
}

function canRetry(doc: StoredDocument, req: AuthenticatedRequest): boolean {
  return (
    !doc.deletedAt &&
    isLatestVersion(doc) &&
    req.user!.role === UserRole.OWNER &&
    doc.ownerId === req.user!.id &&
    (doc.reviewStatus === 'rejected' || doc.reviewStatus === 'expired')
  );
}

function safeDoc(d: StoredDocument, req?: AuthenticatedRequest) {
  // Never return encrypted content in list responses
  const { encryptedContent: _c, encryptedThumbnail: _t, reviewedBy: _reviewer, ...meta } = d;
  return {
    ...meta,
    ...(req ? { canReview: canReview(d, req), canRetry: canRetry(d, req) } : {}),
  };
}

// ─── GET /documents?petId=&category=&includeDeleted= ─────────────────────────

router.get('/', (req: AuthenticatedRequest, res) => {
  const { petId, category, includeDeleted } = req.query as Record<string, string | undefined>;

  let list = [...docs().values()];

  if (petId) list = list.filter((d) => d.petId === petId);
  if (category) list = list.filter((d) => d.category === category);
  if (includeDeleted !== 'true') list = list.filter((d) => !d.deletedAt);

  // Only latest version per document chain
  const latestByParent = new Map<string, StoredDocument>();
  for (const d of list) {
    const key = d.parentId ?? d.id;
    const existing = latestByParent.get(key);
    if (!existing || d.version > existing.version) latestByParent.set(key, d);
  }

  const result = [...latestByParent.values()]
    .filter((d) => canAccess(d, req))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((document) => safeDoc(document, req));

  return res.json({ success: true, data: result, total: result.length });
});

// ─── GET /documents/:id ───────────────────────────────────────────────────────

router.get('/:id', (req: AuthenticatedRequest, res) => {
  const doc = docs().get(req.params.id);
  if (!doc || doc.deletedAt) return sendError(res, 404, 'NOT_FOUND', 'Document not found');
  if (!canAccess(doc, req)) return sendError(res, 403, 'FORBIDDEN', 'Access denied');

  // Return full payload including encrypted content for download
  return res.json({
    success: true,
    data: {
      ...safeDoc(doc, req),
      encryptedContent: doc.encryptedContent,
      encryptedThumbnail: doc.encryptedThumbnail,
    },
  });
});

// ─── GET /documents/:id/versions ─────────────────────────────────────────────

router.get('/:id/versions', (req: AuthenticatedRequest, res) => {
  const doc = docs().get(req.params.id);
  if (!doc) return sendError(res, 404, 'NOT_FOUND', 'Document not found');
  if (!canAccess(doc, req)) return sendError(res, 403, 'FORBIDDEN', 'Access denied');

  const rootId = doc.parentId ?? doc.id;
  const versions = [...docs().values()]
    .filter((d) => (d.parentId ?? d.id) === rootId)
    .sort((a, b) => a.version - b.version)
    .map((document) => safeDoc(document, req));

  return res.json({ success: true, data: versions });
});

// ─── POST /documents ──────────────────────────────────────────────────────────

router.post('/', (req: AuthenticatedRequest, res) => {
  const body = req.body as Partial<StoredDocument> & { parentId?: string; retryOfId?: string };

  // Validation
  if (!body.petId?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'petId is required');
  if (!body.name?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
  if (!body.mimeType?.trim())
    return sendError(res, 400, 'VALIDATION_ERROR', 'mimeType is required');
  if (!body.encryptedContent?.trim())
    return sendError(res, 400, 'VALIDATION_ERROR', 'encryptedContent is required');
  if (!body.iv?.trim() || !body.tag?.trim())
    return sendError(res, 400, 'VALIDATION_ERROR', 'iv and tag are required');
  if (!ALLOWED_MIME.has(body.mimeType)) {
    return sendError(
      res,
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      `Allowed types: ${[...ALLOWED_MIME].join(', ')}`,
    );
  }
  if (!body.sizeBytes || body.sizeBytes > MAX_UPLOAD_BYTES) {
    return sendError(
      res,
      413,
      'FILE_TOO_LARGE',
      `Maximum file size is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
    );
  }

  // Ownership check
  const pet = store.pets.get(body.petId.trim());
  if (!pet) return sendError(res, 400, 'VALIDATION_ERROR', 'petId must reference an existing pet');
  if (req.user!.role === UserRole.OWNER && pet.ownerId !== req.user!.id) {
    return sendError(res, 403, 'FORBIDDEN', 'You can only upload documents for your own pets');
  }

  // Quota check
  const used = ownerQuotaUsed(req.user!.id);
  const limit = ownerQuotaLimit(req);
  if (used + body.sizeBytes > limit) {
    return sendError(
      res,
      413,
      'QUOTA_EXCEEDED',
      `Storage quota exceeded. Used: ${used}, Limit: ${limit}`,
    );
  }

  // Versioning: if parentId provided, find latest version
  let version = 1;
  let parentId: string | undefined;
  const retrySource = body.retryOfId ? docs().get(body.retryOfId) : undefined;
  if (body.retryOfId) {
    if (!retrySource || retrySource.deletedAt || !canAccess(retrySource, req)) {
      return sendError(res, 404, 'NOT_FOUND', 'Attachment not found');
    }
    if (retrySource.reviewStatus !== 'rejected' && retrySource.reviewStatus !== 'expired') {
      return sendError(res, 409, 'STALE_ATTACHMENT', 'This attachment cannot be retried');
    }
    if (!isLatestVersion(retrySource)) {
      return sendError(res, 409, 'STALE_ATTACHMENT', 'A newer attachment version already exists');
    }
    if (req.user!.role !== UserRole.OWNER || retrySource.ownerId !== req.user!.id) {
      return sendError(res, 403, 'FORBIDDEN', 'Only the document owner can retry an attachment');
    }
    if (retrySource.petId !== body.petId.trim()) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Retry attachment must belong to this pet');
    }
  }
  const versionSourceId = retrySource?.id ?? body.parentId;
  if (versionSourceId) {
    const parent = docs().get(versionSourceId);
    if (!parent) return sendError(res, 400, 'VALIDATION_ERROR', 'parentId not found');
    if (!canAccess(parent, req)) return sendError(res, 403, 'FORBIDDEN', 'Access denied');
    parentId = parent.parentId ?? parent.id;
    const existing = [...docs().values()].filter((d) => (d.parentId ?? d.id) === parentId);
    version = Math.max(...existing.map((d) => d.version)) + 1;
  }

  const t = new Date().toISOString();
  const id = randomUUID();
  const doc: StoredDocument = {
    id,
    petId: body.petId.trim(),
    ownerId: req.user!.id,
    name: body.name.trim(),
    category: (body.category as DocumentCategory) ?? 'other',
    mimeType: body.mimeType,
    sizeBytes: body.sizeBytes,
    encryptedContent: body.encryptedContent,
    iv: body.iv,
    tag: body.tag,
    keyVersion: body.keyVersion ?? 1,
    encryptedThumbnail: body.encryptedThumbnail,
    version,
    parentId,
    reviewStatus: 'pending_review',
    createdAt: t,
    updatedAt: t,
  };
  docs().set(id, doc);

  void logAuditTrail({
    req,
    entityType: 'document',
    entityId: id,
    action: 'CREATE',
    before: null,
    after: safeDoc(doc),
  });
  logger.info('document_uploaded', {
    documentId: id,
    petId: doc.petId,
    version,
    mimeType: doc.mimeType,
  });

  return res.status(201).json({ success: true, data: safeDoc(doc, req) });
});

// ─── POST /documents/:id/review ──────────────────────────────────────────────

router.post('/:id/review', (req: AuthenticatedRequest, res) => {
  const doc = docs().get(req.params.id);
  if (!doc || doc.deletedAt) return sendError(res, 404, 'NOT_FOUND', 'Document not found');
  if (!canAccess(doc, req)) return sendError(res, 403, 'FORBIDDEN', 'Access denied');
  if (!isReviewerFor(doc, req)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to review this attachment');
  }
  if (doc.reviewStatus !== 'pending_review' || !isLatestVersion(doc)) {
    return sendError(res, 409, 'STALE_ATTACHMENT', 'Attachment is no longer awaiting review');
  }

  const status = (req.body as { status?: unknown }).status;
  if (status !== 'accepted' && status !== 'rejected' && status !== 'expired') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'A valid review status is required');
  }

  const t = new Date().toISOString();
  const reviewed: StoredDocument = {
    ...doc,
    reviewStatus: status,
    reviewedBy: req.user!.id,
    reviewedAt: t,
    updatedAt: t,
  };
  docs().set(doc.id, reviewed);

  void logAuditTrail({
    req,
    entityType: 'document',
    entityId: doc.id,
    action: 'UPDATE',
    before: safeDoc(doc),
    after: safeDoc(reviewed),
  });

  return res.json({ success: true, data: safeDoc(reviewed, req) });
});

// ─── DELETE /documents/:id (soft-delete) ─────────────────────────────────────

router.delete('/:id', (req: AuthenticatedRequest, res) => {
  const doc = docs().get(req.params.id);
  if (!doc || doc.deletedAt) return sendError(res, 404, 'NOT_FOUND', 'Document not found');
  if (!canAccess(doc, req)) return sendError(res, 403, 'FORBIDDEN', 'Access denied');
  if (req.user!.role === UserRole.VET)
    return sendError(res, 403, 'FORBIDDEN', 'Vets cannot delete documents');

  const deleted = {
    ...doc,
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  docs().set(doc.id, deleted);

  void logAuditTrail({
    req,
    entityType: 'document',
    entityId: doc.id,
    action: 'DELETE',
    before: safeDoc(doc),
    after: safeDoc(deleted),
  });
  logger.info('document_soft_deleted', { documentId: doc.id });

  return res.json(ok(null, 'Document deleted'));
});

// ─── POST /documents/:id/restore ─────────────────────────────────────────────

router.post('/:id/restore', (req: AuthenticatedRequest, res) => {
  const doc = docs().get(req.params.id);
  if (!doc) return sendError(res, 404, 'NOT_FOUND', 'Document not found');
  if (!doc.deletedAt) return sendError(res, 400, 'VALIDATION_ERROR', 'Document is not deleted');
  if (!canAccess(doc, req)) return sendError(res, 403, 'FORBIDDEN', 'Access denied');
  if (req.user!.role === UserRole.VET)
    return sendError(res, 403, 'FORBIDDEN', 'Vets cannot restore documents');

  // Quota check on restore
  const used = ownerQuotaUsed(doc.ownerId);
  const limit = ownerQuotaLimit(req);
  if (used + doc.sizeBytes > limit) {
    return sendError(res, 413, 'QUOTA_EXCEEDED', 'Cannot restore: storage quota exceeded');
  }

  const restored = { ...doc, deletedAt: undefined, updatedAt: new Date().toISOString() };
  docs().set(doc.id, restored);

  void logAuditTrail({
    req,
    entityType: 'document',
    entityId: doc.id,
    action: 'UPDATE',
    before: safeDoc(doc),
    after: safeDoc(restored),
  });
  logger.info('document_restored', { documentId: doc.id });

  return res.json({ success: true, data: safeDoc(restored) });
});

// ─── GET /documents/quota/:ownerId ────────────────────────────────────────────

router.get('/quota/:ownerId', (req: AuthenticatedRequest, res) => {
  const { ownerId } = req.params;
  if (req.user!.role === UserRole.OWNER && req.user!.id !== ownerId) {
    return sendError(res, 403, 'FORBIDDEN', 'Access denied');
  }
  const used = ownerQuotaUsed(ownerId);
  const limit = ownerQuotaLimit(req);
  return res.json({ success: true, data: { used, limit, remaining: limit - used } });
});

export default router;
