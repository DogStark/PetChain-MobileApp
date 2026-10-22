/* eslint-disable @typescript-eslint/no-non-null-assertion */
import express from 'express';

import type { AuditableRequest } from '../../middleware/auditLog';
import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import { ok, sendError } from '../response';
import { store, type StoredMedicalRecord } from '../store';

const router = express.Router();

export type AllergyVerificationStatus = 'unverified' | 'pending' | 'verified' | 'conflicting';
export type AllergySource = 'owner' | 'vet' | 'imported' | 'system';

export interface StoredAllergyEntry {
  id: string;
  petId: string;
  allergen: string;
  reaction?: string;
  severity?: 'mild' | 'moderate' | 'severe';
  onsetDate?: string;
  observedAt: string;
  source: AllergySource;
  sourceReference?: string;
  verificationStatus: AllergyVerificationStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  conflictGroupId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type CorrectionRequestStatus = 'pending' | 'approved' | 'rejected';

export interface StoredCorrectionRequest {
  id: string;
  petId: string;
  allergyId: string;
  requestedChange: string;
  reason?: string;
  requestedBy: string;
  status: CorrectionRequestStatus;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const allergyEntries = new Map<string, StoredAllergyEntry>();
const correctionRequests = new Map<string, StoredCorrectionRequest>();

function toApiRecord(r: StoredMedicalRecord) {
  return {
    id: r.id,
    petId: r.petId,
    vetId: r.vetId,
    type: r.type,
    diagnosis: r.diagnosis,
    treatment: r.treatment,
    notes: r.notes,
    visitDate: r.visitDate,
    nextVisitDate: r.nextVisitDate,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    // Blockchain verification fields
    blockchainTxHash: r.blockchainTxHash,
    blockchainHash: r.blockchainHash,
    isBlockchainVerified: r.isBlockchainVerified,
    blockchainVerifiedAt: r.blockchainVerifiedAt,
  };
}

function toApiAllergy(e: StoredAllergyEntry) {
  return {
    id: e.id,
    petId: e.petId,
    allergen: e.allergen,
    reaction: e.reaction,
    severity: e.severity,
    onsetDate: e.onsetDate,
    observedAt: e.observedAt,
    source: e.source,
    sourceReference: e.sourceReference,
    verificationStatus: e.verificationStatus,
    verifiedBy: e.verifiedBy,
    verifiedAt: e.verifiedAt,
    conflictGroupId: e.conflictGroupId,
    notes: e.notes,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function toApiCorrectionRequest(r: StoredCorrectionRequest) {
  return {
    id: r.id,
    petId: r.petId,
    allergyId: r.allergyId,
    requestedChange: r.requestedChange,
    reason: r.reason,
    requestedBy: r.requestedBy,
    status: r.status,
    resolvedBy: r.resolvedBy,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function canViewPet(req: AuthenticatedRequest, petId: string): boolean {
  const pet = store.pets.get(petId);
  if (!pet) return false;
  if (req.user!.role === UserRole.OWNER) return pet.ownerId === req.user!.id;
  return true;
}

function isStaff(req: AuthenticatedRequest): boolean {
  return req.user!.role === UserRole.ADMIN || req.user!.role === UserRole.VET;
}

// All medical record routes require authentication
router.use(authenticateJWT);

/**
 * GET /medical-records/search?q=&petId=
 * Full-text search with ts-rank-style scoring (Issue #536).
 */
router.get('/search', (req: AuthenticatedRequest, res) => {
  const { petId, q } = req.query as { petId?: string; q?: string };
  if (!q?.trim()) return sendError(res, 400, 'VALIDATION_ERROR', 'Query parameter q is required');

  const terms = q.trim().toLowerCase().split(/\s+/);

  function tsRank(r: StoredMedicalRecord): number {
    const haystack = [r.notes, r.diagnosis, r.treatment, r.type]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return terms.reduce((score, t) => score + (haystack.includes(t) ? 1 : 0), 0);
  }

  let list = [...store.medicalRecords.values()];

  if (petId) {
    if (req.user!.role === UserRole.OWNER) {
      const pet = store.pets.get(petId);
      if (!pet || pet.ownerId !== req.user!.id)
        return sendError(res, 403, 'FORBIDDEN', 'No permission to view these records');
    }
    list = list.filter((r) => r.petId === petId);
  } else if (req.user!.role === UserRole.OWNER) {
    return sendError(res, 403, 'FORBIDDEN', 'petId is required for pet owners');
  }

  const results = list
    .map((r) => ({ record: r, rank: tsRank(r) }))
    .filter(({ rank }) => rank > 0)
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        new Date(b.record.visitDate).getTime() - new Date(a.record.visitDate).getTime(),
    )
    .map(({ record }) => toApiRecord(record));

  return res.json(ok(results));
});

/**
 * GET /medical-records/pet/:petId/allergies
 * Longitudinal allergy and reaction history, newest first.
 */
router.get('/pet/:petId/allergies', (req: AuthenticatedRequest, res) => {
  const petId = req.params.petId as string;
  const pet = store.pets.get(petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  if (!canViewPet(req, petId))
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to view this history');

  const list = [...allergyEntries.values()]
    .filter((e) => e.petId === petId)
    .sort((a, b) => {
      const ad = new Date(a.observedAt).getTime();
      const bd = new Date(b.observedAt).getTime();
      return bd - ad || b.createdAt.localeCompare(a.createdAt);
    })
    .map(toApiAllergy);

  (req as AuditableRequest).audit?.('allergy_history.accessed', 'pet', petId, {
    count: list.length,
  });
  return res.json(ok(list));
});

/**
 * POST /medical-records/pet/:petId/allergies
 * Record a dated allergy or reaction entry. Owners may report for their own pets
 * (status unverified); staff entries are verified.
 */
router.post('/pet/:petId/allergies', (req: AuthenticatedRequest, res) => {
  const petId = req.params.petId as string;
  const pet = store.pets.get(petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  if (!canViewPet(req, petId))
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to record this history');

  const body = req.body as {
    allergen?: unknown;
    reaction?: unknown;
    severity?: unknown;
    onsetDate?: unknown;
    observedAt?: unknown;
    source?: unknown;
    sourceReference?: unknown;
    notes?: unknown;
  };

  if (typeof body.allergen !== 'string' || !body.allergen.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'allergen is required');
  }

  const observedAtRaw = typeof body.observedAt === 'string' ? body.observedAt : undefined;
  if (observedAtRaw && Number.isNaN(new Date(observedAtRaw).getTime())) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'observedAt must be a valid date');
  }
  const onsetDateRaw = typeof body.onsetDate === 'string' ? body.onsetDate : undefined;
  if (onsetDateRaw && Number.isNaN(new Date(onsetDateRaw).getTime())) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'onsetDate must be a valid date');
  }

  const severity =
    body.severity === 'mild' || body.severity === 'moderate' || body.severity === 'severe'
      ? body.severity
      : undefined;
  if (body.severity !== undefined && !severity) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'severity must be mild, moderate, or severe');
  }

  const staff = isStaff(req);
  const source: AllergySource = staff
    ? body.source === 'owner' || body.source === 'vet' || body.source === 'imported' || body.source === 'system'
      ? body.source
      : 'vet'
    : 'owner';

  const now = new Date().toISOString();
  const id = store.newId();
  const entry: StoredAllergyEntry = {
    id: `allergy-${id}`,
    petId,
    allergen: body.allergen.trim(),
    reaction: typeof body.reaction === 'string' ? body.reaction.trim() : undefined,
    severity,
    onsetDate: onsetDateRaw,
    observedAt: observedAtRaw ?? now,
    source,
    sourceReference:
      typeof body.sourceReference === 'string' ? body.sourceReference.trim() : undefined,
    verificationStatus: staff ? 'verified' : 'unverified',
    verifiedBy: staff ? req.user!.id : undefined,
    verifiedAt: staff ? now : undefined,
    notes: typeof body.notes === 'string' ? body.notes.trim() : undefined,
    createdAt: now,
    updatedAt: now,
  };

  // Detect conflicting records for the same allergen and mark them for correction.
  const conflicting = [...allergyEntries.values()].filter(
    (e) =>
      e.petId === petId &&
      e.id !== entry.id &&
      e.allergen.trim().toLowerCase() === entry.allergen.toLowerCase() &&
      (e.reaction || '') !== (entry.reaction || ''),
  );
  if (conflicting.length > 0) {
    const groupId = `conflict-${id}`;
    entry.conflictGroupId = groupId;
    entry.verificationStatus = 'conflicting';
    for (const c of conflicting) {
      allergyEntries.set(c.id, {
        ...c,
        conflictGroupId: c.conflictGroupId ?? groupId,
        verificationStatus: 'conflicting',
        updatedAt: now,
      });
    }
  }

  allergyEntries.set(entry.id, entry);
  (req as AuditableRequest).audit?.('allergy_entry.created', 'pet', petId, {
    allergyId: entry.id,
    source: entry.source,
    conflict: Boolean(entry.conflictGroupId),
  });
  return res.status(201).json(ok(toApiAllergy(entry), 'Allergy entry recorded'));
});

/**
 * POST /medical-records/pet/:petId/allergies/:recordId/correction-requests
 * Request a correction for a conflicting or stale allergy record.
 */
router.post(
  '/pet/:petId/allergies/:recordId/correction-requests',
  (req: AuthenticatedRequest, res) => {
    const petId = req.params.petId as string;
    const recordId = req.params.recordId as string;
    const pet = store.pets.get(petId);
    if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
    if (!canViewPet(req, petId))
      return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to request corrections');

    const record = allergyEntries.get(recordId);
    if (!record || record.petId !== petId)
      return sendError(res, 404, 'NOT_FOUND', 'Allergy record not found');

    const body = req.body as { requestedChange?: unknown; reason?: unknown };
    if (typeof body.requestedChange !== 'string' || !body.requestedChange.trim()) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'requestedChange is required');
    }

    const now = new Date().toISOString();
    const id = `correction-${store.newId()}`;
    const created: StoredCorrectionRequest = {
      id,
      petId,
      allergyId: recordId,
      requestedChange: body.requestedChange.trim(),
      reason: typeof body.reason === 'string' ? body.reason.trim() : undefined,
      requestedBy: req.user!.id,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    correctionRequests.set(id, created);
    (req as AuditableRequest).audit?.('allergy_correction.requested', 'pet', petId, {
      allergyId: recordId,
      correctionId: id,
    });
    return res.status(201).json(ok(toApiCorrectionRequest(created), 'Correction request submitted'));
  },
);

/**
 * GET /medical-records/pet/:petId/allergies/correction-requests
 * List correction requests for a pet's allergy history.
 */
router.get('/pet/:petId/allergies/correction-requests', (req: AuthenticatedRequest, res) => {
  const petId = req.params.petId as string;
  const pet = store.pets.get(petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  if (!canViewPet(req, petId))
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to view this history');

  const list = [...correctionRequests.values()]
    .filter((r) => r.petId === petId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toApiCorrectionRequest);

  return res.json(ok(list));
});

export default router;
