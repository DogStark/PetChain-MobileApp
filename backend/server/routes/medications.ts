/* eslint-disable @typescript-eslint/no-non-null-assertion */
import express from 'express';

import { logAuditTrail } from '../../middleware/auditLogger';
import { authenticateJWT, authorizeRoles, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import { ok, sendError } from '../response';
import { store, type StoredMedication } from '../store';

const router = express.Router();

// All medication routes require authentication
router.use(authenticateJWT);

router.get('/', (req: AuthenticatedRequest, res) => {
  const petId = (req.query as Record<string, string | undefined>).petId;

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
        'You do not have permission to view these medications',
      );
    }
  }

  let list = [...store.medications.values()];
  if (petId) list = list.filter((m) => m.petId === petId);
  return res.json(ok(list));
});

router.get('/:id', (req: AuthenticatedRequest, res) => {
  const row = store.medications.get(req.params.id);
  if (!row) return sendError(res, 404, 'NOT_FOUND', 'Medication not found');

  const pet = store.pets.get(row.petId);
  if (pet && req.user!.role === UserRole.OWNER && req.user!.id !== pet.ownerId) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to view this medication');
  }

  return res.json(ok(row));
});

// Admin and Vet can create, update, or delete medications
router.post('/', authorizeRoles(UserRole.ADMIN, UserRole.VET), (req, res) => {
  const body = req.body as Partial<StoredMedication>;
  if (
    !body.petId?.trim() ||
    !body.name?.trim() ||
    !body.dosage?.trim() ||
    !body.frequency?.trim() ||
    !body.startDate?.trim()
  ) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'petId, name, dosage, frequency, and startDate are required',
    );
  }
  if (!store.pets.get(body.petId.trim())) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'petId must reference an existing pet');
  }
  const id = store.newId();
  const row: StoredMedication = {
    id,
    petId: body.petId.trim(),
    name: body.name.trim(),
    dosage: body.dosage.trim(),
    frequency: body.frequency.trim(),
    startDate: body.startDate.trim(),
    endDate: body.endDate?.trim(),
    active: body.active !== false,
  };
  store.medications.set(id, row);
  void logAuditTrail({
    req: req as AuthenticatedRequest,
    entityType: 'medication',
    entityId: id,
    action: 'CREATE',
    before: null,
    after: row,
  });
  return res.status(201).json(ok(row, 'Medication created'));
});

router.put('/:id', authorizeRoles(UserRole.ADMIN, UserRole.VET), (req, res) => {
  const row = store.medications.get(req.params.id);
  if (!row) return sendError(res, 404, 'NOT_FOUND', 'Medication not found');
  const b = req.body as Partial<StoredMedication>;
  const next: StoredMedication = {
    ...row,
    ...(b.name !== undefined ? { name: String(b.name) } : {}),
    ...(b.dosage !== undefined ? { dosage: String(b.dosage) } : {}),
    ...(b.frequency !== undefined ? { frequency: String(b.frequency) } : {}),
    ...(b.startDate !== undefined ? { startDate: String(b.startDate) } : {}),
    ...(b.endDate !== undefined ? { endDate: b.endDate } : {}),
    ...(b.active !== undefined ? { active: Boolean(b.active) } : {}),
    ...(b.petId !== undefined ? { petId: String(b.petId) } : {}),
  };
  store.medications.set(row.id, next);
  void logAuditTrail({
    req: req as AuthenticatedRequest,
    entityType: 'medication',
    entityId: row.id,
    action: 'UPDATE',
    before: row,
    after: next,
  });
  return res.json(ok(next, 'Medication updated'));
});

router.delete('/:id', authorizeRoles(UserRole.ADMIN, UserRole.VET), (req, res) => {
  const existing = store.medications.get(req.params.id);
  if (!existing) {
    return sendError(res, 404, 'NOT_FOUND', 'Medication not found');
  }
  store.medications.delete(req.params.id);
  void logAuditTrail({
    req: req as AuthenticatedRequest,
    entityType: 'medication',
    entityId: existing.id,
    action: 'DELETE',
    before: existing,
    after: null,
  });
  return res.json(ok(null, 'Medication deleted'));
});

// ── Dosage Approval Routes ───────────────────────────────────────────────────

interface DosageApprovalRequest {
  id: string;
  medicationId: string;
  petId: string;
  petName: string;
  petWeight: number;
  drugName: string;
  calculatedDose: string;
  calculatedDoseUnit: string;
  totalDoseMg: number;
  safetyLevel: string;
  requestedAt: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'modified' | 'rejected';
  vetId?: string;
  approvedDose?: string;
  approvedDoseUnit?: string;
  vetNotes?: string;
  approvedAt?: string;
}

// In-memory store for approval requests (in production, use database)
const approvalRequests = new Map<string, DosageApprovalRequest>();

router.post('/dosage-approvals', (req: AuthenticatedRequest, res) => {
  const body = req.body as Partial<DosageApprovalRequest>;

  if (
    !body.petId?.trim() ||
    !body.petName?.trim() ||
    !body.drugName?.trim() ||
    !body.calculatedDose?.trim() ||
    !body.vetId?.trim()
  ) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'petId, petName, drugName, calculatedDose, and vetId are required',
    );
  }

  const id = `approval_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const request: DosageApprovalRequest = {
    id,
    medicationId: body.medicationId || `med_${Date.now()}`,
    petId: body.petId.trim(),
    petName: body.petName.trim(),
    petWeight: body.petWeight || 0,
    drugName: body.drugName.trim(),
    calculatedDose: body.calculatedDose.trim(),
    calculatedDoseUnit: body.calculatedDoseUnit || 'mg',
    totalDoseMg: body.totalDoseMg || 0,
    safetyLevel: body.safetyLevel || 'unknown',
    requestedAt: new Date().toISOString(),
    requestedBy: req.user!.id,
    status: 'pending',
    vetId: body.vetId.trim(),
  };

  approvalRequests.set(id, request);

  void logAuditTrail({
    req,
    entityType: 'dosage_approval',
    entityId: id,
    action: 'CREATE',
    before: null,
    after: request,
  });

  return res.status(201).json(ok(request, 'Dosage approval request created'));
});

router.get('/dosage-approvals/:id', (req: AuthenticatedRequest, res) => {
  const request = approvalRequests.get(req.params.id);
  if (!request) {
    return sendError(res, 404, 'NOT_FOUND', 'Approval request not found');
  }

  // Owners can view their own requests, vets can view requests assigned to them
  if (
    req.user!.role === UserRole.OWNER &&
    request.requestedBy !== req.user!.id
  ) {
    return sendError(res, 403, 'FORBIDDEN', 'Not authorized to view this request');
  }

  if (
    req.user!.role === UserRole.VET &&
    request.vetId !== req.user!.id
  ) {
    return sendError(res, 403, 'FORBIDDEN', 'Not authorized to view this request');
  }

  return res.json(ok(request));
});

router.post('/dosage-approvals/:id/approve', authorizeRoles(UserRole.VET, UserRole.ADMIN), (req, res) => {
  const request = approvalRequests.get(req.params.id);
  if (!request) {
    return sendError(res, 404, 'NOT_FOUND', 'Approval request not found');
  }

  if (request.status !== 'pending') {
    return sendError(res, 400, 'INVALID_STATE', 'Request has already been processed');
  }

  const body = req.body as { approvedDose?: string; approvedDoseUnit?: string; vetNotes?: string };

  const before = { ...request };
  request.status = body.approvedDose ? 'modified' : 'approved';
  request.approvedDose = body.approvedDose;
  request.approvedDoseUnit = body.approvedDoseUnit;
  request.vetNotes = body.vetNotes;
  request.approvedAt = new Date().toISOString();

  approvalRequests.set(request.id, request);

  void logAuditTrail({
    req: req as AuthenticatedRequest,
    entityType: 'dosage_approval',
    entityId: request.id,
    action: 'APPROVE',
    before,
    after: request,
  });

  return res.json(ok(request, 'Dosage approved'));
});

router.post('/dosage-approvals/:id/reject', authorizeRoles(UserRole.VET, UserRole.ADMIN), (req, res) => {
  const request = approvalRequests.get(req.params.id);
  if (!request) {
    return sendError(res, 404, 'NOT_FOUND', 'Approval request not found');
  }

  if (request.status !== 'pending') {
    return sendError(res, 400, 'INVALID_STATE', 'Request has already been processed');
  }

  const body = req.body as { vetNotes?: string };

  const before = { ...request };
  request.status = 'rejected';
  request.vetNotes = body.vetNotes;
  request.approvedAt = new Date().toISOString();

  approvalRequests.set(request.id, request);

  void logAuditTrail({
    req: req as AuthenticatedRequest,
    entityType: 'dosage_approval',
    entityId: request.id,
    action: 'REJECT',
    before,
    after: request,
  });

  return res.json(ok(request, 'Dosage rejected'));
});

export default router;
