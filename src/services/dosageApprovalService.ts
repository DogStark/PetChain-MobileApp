import { sendMessage } from './vetService';
import { upsertMedication } from './localDB';
import type { Medication } from '../models/Medication';
import type { DosageResult } from '../utils/dosageCalculator';

export interface DosageApprovalRequest {
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

export async function requestVetApproval(params: {
  petId: string;
  petName: string;
  petWeight: number;
  drugName: string;
  dosageResult: DosageResult;
  vetId: string;
  medicationData: Partial<Medication>;
}): Promise<DosageApprovalRequest> {
  const request: DosageApprovalRequest = {
    id: `approval_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    medicationId: params.medicationData.id || `med_${Date.now()}`,
    petId: params.petId,
    petName: params.petName,
    petWeight: params.petWeight,
    drugName: params.drugName,
    calculatedDose: params.dosageResult.dose.toString(),
    calculatedDoseUnit: params.dosageResult.unit,
    totalDoseMg: params.dosageResult.doseInMg,
    safetyLevel: params.dosageResult.safetyLevel,
    requestedAt: new Date().toISOString(),
    requestedBy: 'owner',
    status: 'pending',
    vetId: params.vetId,
  };

  const messageContent = `
🔔 Dosage Approval Request

Pet: ${params.petName}
Weight: ${params.petWeight} kg
Medication: ${params.drugName}

Calculated Dose: ${params.dosageResult.dose} ${params.dosageResult.unit} (${params.dosageResult.doseInMg} mg total)
Safety Level: ${params.dosageResult.safetyLevel.toUpperCase()}

${params.dosageResult.warnings.length > 0 ? `⚠️ Warnings:\n${params.dosageResult.warnings.map((w) => `• ${w}`).join('\n')}` : ''}

Please review and approve or modify this dosage calculation.

Request ID: ${request.id}
  `.trim();

  await sendMessage(params.vetId, { content: messageContent });

  const pendingMedication: Medication = {
    id: request.medicationId,
    petId: params.petId,
    name: params.drugName,
    dosage: `${params.dosageResult.dose} ${params.dosageResult.unit}`,
    frequency: params.medicationData.frequency || 24,
    startDate: params.medicationData.startDate || new Date().toISOString(),
    endDate: params.medicationData.endDate,
    instructions: params.medicationData.instructions,
    status: 'paused',
    notes: `Pending vet approval - Request ID: ${request.id}`,
    ...params.medicationData,
  };

  await upsertMedication(pendingMedication);

  return request;
}

export async function approveDosage(
  requestId: string,
  approvedDose?: string,
  approvedUnit?: string,
  vetNotes?: string,
): Promise<DosageApprovalRequest> {
  const request: DosageApprovalRequest = {
    id: requestId,
    medicationId: '',
    petId: '',
    petName: '',
    petWeight: 0,
    drugName: '',
    calculatedDose: '',
    calculatedDoseUnit: '',
    totalDoseMg: 0,
    safetyLevel: '',
    requestedAt: '',
    requestedBy: '',
    status: approvedDose ? 'modified' : 'approved',
    approvedDose,
    approvedDoseUnit,
    vetNotes,
    approvedAt: new Date().toISOString(),
  };

  return request;
}

export async function activateApprovedMedication(
  medicationId: string,
  approvedDosage: string,
): Promise<void> {
  const medications = await import('./medicationService').then((m) => m.getMedications());
  const medication = medications.find((m) => m.id === medicationId);

  if (!medication) {
    throw new Error('Medication not found');
  }

  const activated: Medication = {
    ...medication,
    dosage: approvedDosage,
    status: 'active',
    notes: medication.notes?.replace(/Pending vet approval.*/, 'Approved by veterinarian'),
  };

  await upsertMedication(activated);
}
