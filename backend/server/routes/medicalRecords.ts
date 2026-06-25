/* eslint-disable @typescript-eslint/no-non-null-assertion */
import express from 'express';

import type { AuditableRequest } from '../../middleware/auditLog';
import { authenticateJWT, authorizeRoles, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import referralService from '../../services/referralService';
import stellarAnchorService from '../../services/stellarService';
import { ok, sendError } from '../response';
import { store, type StoredMedicalRecord } from '../store';

const router = express.Router();

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

// All medical record routes require authentication
router.use(authenticateJWT);

router.get('/pet/:petId', (req: AuthenticatedRequest, res) => {
  const petId = req.params.petId as string;
  const pet = store.pets.get(petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');

  // Only admin, vet, or the owner can view medical records
  if (req.user!.role === UserRole.OWNER && req.user!.id !== pet.ownerId) {
    return sendError(
      res,
      403,
      'FORBIDDEN',
      'You do not have permission to view these medical records',
    );
  }

  const list = [...store.medicalRecords.values()].filter((r) => r.petId === petId).map(toApiRecord);
  (req as AuditableRequest).audit?.('medical_record.accessed', 'medical_record', undefined, {
    petId,
  });
  return res.json(ok(list));
});

router.get('/', (req: AuthenticatedRequest, res) => {
  const { petId, vetId, type, startDate, endDate, diagnosis } = req.query as {
    petId?: string;
    vetId?: string;
    type?: string;
    startDate?: string;
    endDate?: string;
    diagnosis?: string;
  };

  // Owners must provide petId
  if (req.user!.role === UserRole.OWNER && !petId) {
    return sendError(res, 403, 'FORBIDDEN', 'PetId parameter is required for pet owners');
  }

  if (petId) {
    const pet = store.pets.get(petId);
    if (pet && req.user!.role === UserRole.OWNER && req.user!.id !== pet.ownerId) {
      return sendError(
        res,
        403,
        'FORBIDDEN',
        'You do not have permission to view these medical records',
      );
    }
  }

  let list = [...store.medicalRecords.values()];
  if (petId) list = list.filter((r) => r.petId === petId);
  if (vetId) list = list.filter((r) => r.vetId === vetId);
  if (type) list = list.filter((r) => r.type === type);
  if (startDate) list = list.filter((r) => new Date(r.visitDate) >= new Date(startDate));
  if (endDate) list = list.filter((r) => new Date(r.visitDate) <= new Date(endDate));
  if (diagnosis)
    list = list.filter(
      (r) => r.diagnosis && r.diagnosis.toLowerCase().includes(diagnosis.toLowerCase()),
    );
  list.sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime());

  // Log bulk access with fire-and-forget pattern (non-blocking)
  (req as AuditableRequest).audit?.('medical_record.accessed', 'medical_record', undefined, {
    petId,
    vetId,
    type,
    recordCount: list.length,
  });

  return res.json(ok(list.map(toApiRecord)));
});

router.get('/:id', (req: AuthenticatedRequest, res) => {
  const row = store.medicalRecords.get(req.params.id);
  if (!row) return sendError(res, 404, 'NOT_FOUND', 'Medical record not found');

  const pet = store.pets.get(row.petId);
  // Only admin, vet, or the owner can view this record
  if (pet && req.user!.role === UserRole.OWNER && req.user!.id !== pet.ownerId) {
    return sendError(
      res,
      403,
      'FORBIDDEN',
      'You do not have permission to view this medical record',
    );
  }

  (req as AuditableRequest).audit?.('medical_record.accessed', 'medical_record', row.id);
  return res.json(ok(toApiRecord(row)));
});

router.post('/:id/anchor', authorizeRoles(UserRole.ADMIN, UserRole.VET), async (req, res) => {
  const body = req.body as { sourceSecret?: string; network?: 'testnet' | 'mainnet' };
  const row = store.medicalRecords.get(req.params.id);
  if (!row) return sendError(res, 404, 'NOT_FOUND', 'Medical record not found');

  try {
    const result = await stellarAnchorService.anchorRecord({
      recordId: row.id,
      payload: toApiRecord(row),
      sourceSecret: typeof body.sourceSecret === 'string' ? body.sourceSecret : undefined,
      network: body.network === 'mainnet' ? 'mainnet' : 'testnet',
    });

    const next: StoredMedicalRecord = {
      ...row,
      blockchainTxHash: result.transactionId,
      blockchainHash: result.recordHash,
      isBlockchainVerified: result.status !== 'failed',
      blockchainVerifiedAt: new Date().toISOString(),
    };
    store.medicalRecords.set(row.id, next);
    return res.json(ok({ ...result, record: toApiRecord(next) }));
  } catch (error) {
    return sendError(
      res,
      502,
      'STELLAR_ANCHOR_FAILED',
      error instanceof Error ? error.message : 'Failed to anchor record',
    );
  }
});

router.get('/:id/anchor-status', async (req, res) => {
  const row = store.medicalRecords.get(req.params.id);
  if (!row) return sendError(res, 404, 'NOT_FOUND', 'Medical record not found');

  const status = await stellarAnchorService.getTransactionStatus(row.id);
  return res.json(
    ok(
      status ?? {
        recordId: row.id,
        recordHash: row.blockchainHash,
        transactionId: row.blockchainTxHash,
        status: row.blockchainTxHash ? 'submitted' : 'pending',
      },
    ),
  );
});

// Only Admin and Vet can create, update, or delete medical records
router.post('/', authorizeRoles(UserRole.ADMIN, UserRole.VET), (req, res) => {
  const { petId, vetId, type, diagnosis, treatment, notes, visitDate, nextVisitDate } =
    req.body as Partial<StoredMedicalRecord>;
  if (!petId?.trim() || !vetId?.trim() || !type?.trim() || !visitDate?.trim()) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'petId, vetId, type, and visitDate are required',
    );
  }
  if (!store.pets.get(petId.trim())) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'petId must reference an existing pet');
  }
  const t = new Date().toISOString();
  const id = store.newId();
  const row: StoredMedicalRecord = {
    id,
    petId: petId.trim(),
    vetId: vetId.trim(),
    type: String(type),
    diagnosis: diagnosis?.trim(),
    treatment: treatment?.trim(),
    notes: notes?.trim(),
    visitDate: visitDate.trim(),
    nextVisitDate: nextVisitDate?.trim(),
    createdAt: t,
    updatedAt: t,
  };
  store.medicalRecords.set(id, row);
  const pet = store.pets.get(petId.trim());
  if (pet) {
    referralService.completeReferralConversion(pet.ownerId, id);
  }
  (req as AuditableRequest).audit?.('medical_record.created', 'medical_record', id, {
    petId: petId.trim(),
    type: String(type),
  });
  return res.status(201).json(ok(toApiRecord(row), 'Medical record created'));
});

router.put('/:id', authorizeRoles(UserRole.ADMIN, UserRole.VET), (req, res) => {
  const row = store.medicalRecords.get(req.params.id);
  if (!row) return sendError(res, 404, 'NOT_FOUND', 'Medical record not found');
  const b = req.body as Partial<StoredMedicalRecord>;
  const t = new Date().toISOString();
  const next: StoredMedicalRecord = {
    ...row,
    ...(b.type !== undefined ? { type: String(b.type) } : {}),
    ...(b.diagnosis !== undefined ? { diagnosis: b.diagnosis } : {}),
    ...(b.treatment !== undefined ? { treatment: b.treatment } : {}),
    ...(b.notes !== undefined ? { notes: b.notes } : {}),
    ...(b.visitDate !== undefined ? { visitDate: String(b.visitDate) } : {}),
    ...(b.nextVisitDate !== undefined ? { nextVisitDate: b.nextVisitDate } : {}),
    ...(b.vetId !== undefined ? { vetId: String(b.vetId) } : {}),
    ...(b.petId !== undefined ? { petId: String(b.petId) } : {}),
    // Blockchain verification fields (updatable if provided)
    ...(b.blockchainTxHash !== undefined ? { blockchainTxHash: b.blockchainTxHash } : {}),
    ...(b.blockchainHash !== undefined ? { blockchainHash: b.blockchainHash } : {}),
    ...(b.isBlockchainVerified !== undefined
      ? { isBlockchainVerified: b.isBlockchainVerified }
      : {}),
    ...(b.blockchainVerifiedAt !== undefined
      ? { blockchainVerifiedAt: b.blockchainVerifiedAt }
      : {}),
    updatedAt: t,
  };
  store.medicalRecords.set(row.id, next);
  (req as AuditableRequest).audit?.('medical_record.updated', 'medical_record', row.id);
  return res.json(ok(toApiRecord(next)));
});

router.delete(
  '/:id',
  authorizeRoles(UserRole.ADMIN, UserRole.VET),
  (req: AuthenticatedRequest, res) => {
    if (!store.medicalRecords.delete(req.params.id)) {
      return sendError(res, 404, 'NOT_FOUND', 'Medical record not found');
    }
    (req as AuditableRequest).audit?.('medical_record.deleted', 'medical_record', req.params.id);
    return res.json(ok(null, 'Medical record deleted'));
  },
);

export default router;
