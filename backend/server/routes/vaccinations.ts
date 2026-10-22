/* eslint-disable @typescript-eslint/no-non-null-assertion */
import express from 'express';

import type { AuditableRequest } from '../../middleware/auditLog';
import { authenticateJWT, authorizeRoles, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import stellarAnchorService from '../../services/stellarService';
import {
  buildVaccinationRecordHash,
  exportVaccinationCertificate,
  generateVaccinationReminders,
  getStandardVaccinationSchedules,
} from '../../services/vaccinationScheduleService';
import { ok, sendError } from '../response';
import { store, type StoredMedicalRecord } from '../store';

const router = express.Router();

const canAccessPet = (req: AuthenticatedRequest, petId: string): boolean => {
  const pet = store.pets.get(petId);
  if (!pet) return false;
  return req.user!.role !== UserRole.OWNER || pet.ownerId === req.user!.id;
};

router.use(authenticateJWT);

router.get('/schedules', (req, res) => {
  const species = typeof req.query.species === 'string' ? req.query.species : undefined;
  return res.json(ok(getStandardVaccinationSchedules(species)));
});

router.get('/pets/:petId/reminders', (req: AuthenticatedRequest, res) => {
  const pet = store.pets.get(req.params.petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  if (!canAccessPet(req, pet.id)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to view this pet');
  }

  const reminders = generateVaccinationReminders(pet, [...store.medicalRecords.values()]);
  return res.json(ok(reminders));
});

router.get('/pets/:petId/certificate', (req: AuthenticatedRequest, res) => {
  const pet = store.pets.get(req.params.petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');
  if (!canAccessPet(req, pet.id)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to export this pet');
  }

  const certificate = exportVaccinationCertificate(pet, [...store.medicalRecords.values()]);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.send(certificate);
});

router.post(
  '/administered',
  authorizeRoles(UserRole.ADMIN, UserRole.VET),
  async (req: AuthenticatedRequest, res) => {
    const body = req.body as {
      petId?: string;
      vaccineName?: string;
      administeredDate?: string;
      vetId?: string;
      lotNumber?: string;
      manufacturer?: string;
      nextDueDate?: string;
      anchorToBlockchain?: boolean;
      sourceSecret?: string;
      network?: 'testnet' | 'mainnet';
    };

    if (!body.petId?.trim() || !body.vaccineName?.trim() || !body.administeredDate?.trim()) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'petId, vaccineName, and administeredDate are required',
      );
    }

    const pet = store.pets.get(body.petId.trim());
    if (!pet)
      return sendError(res, 400, 'VALIDATION_ERROR', 'petId must reference an existing pet');

    const t = new Date().toISOString();
    const id = store.newId();
    let row: StoredMedicalRecord = {
      id,
      petId: pet.id,
      vetId: body.vetId?.trim() || req.user!.id,
      type: 'vaccination',
      diagnosis: body.vaccineName.trim(),
      treatment: body.vaccineName.trim(),
      notes: [
        body.manufacturer ? `Manufacturer: ${body.manufacturer.trim()}` : '',
        body.lotNumber ? `Lot: ${body.lotNumber.trim()}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
      visitDate: body.administeredDate.trim(),
      nextVisitDate: body.nextDueDate?.trim(),
      createdAt: t,
      updatedAt: t,
      isBlockchainVerified: false,
    };

    if (body.anchorToBlockchain) {
      const recordHash = buildVaccinationRecordHash({
        id,
        petId: pet.id,
        vaccineName: body.vaccineName.trim(),
        administeredDate: body.administeredDate.trim(),
        vetId: row.vetId,
        lotNumber: body.lotNumber,
        manufacturer: body.manufacturer,
      });
      const anchor = await stellarAnchorService.anchorRecord({
        recordId: id,
        payload: { ...row, recordHash },
        sourceSecret: body.sourceSecret,
        network: body.network === 'mainnet' ? 'mainnet' : 'testnet',
      });
      row = {
        ...row,
        blockchainTxHash: anchor.transactionId,
        blockchainHash: anchor.recordHash,
        isBlockchainVerified: anchor.status !== 'failed',
        blockchainVerifiedAt: new Date().toISOString(),
      };
    }

    store.medicalRecords.set(id, row);
    (req as AuditableRequest).audit?.('medical_record.created', 'medical_record', id, {
      petId: pet.id,
      vaccineName: body.vaccineName.trim(),
    });

    return res.status(201).json(ok(row, 'Vaccination administered'));
  },
);

export default router;
