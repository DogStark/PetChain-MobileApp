/**
 * Medical Record domain model for the backend.
 *
 * This model represents the complete medical record structure used by the backend API
 * and matches the frontend models while maintaining API compatibility.
 */

export type MedicalRecordType = 'checkup' | 'vaccination' | 'surgery' | 'treatment' | 'other';
export type MedicalDocumentType = 'pdf' | 'image' | 'other';

export interface MedicalDocumentMetadata {
  id: string;
  name: string;
  mimeType: string;
  type: MedicalDocumentType;
  url: string;
  sizeBytes?: number;
  createdAt?: string;
}

export interface Diagnosis {
  diagnosisText: string;
  code?: string;
  severity?: 'mild' | 'moderate' | 'severe' | 'unknown';
}

export interface Prescription {
  id?: string;
  medicationName: string;
  dosage?: string;
  route?: string;
  frequency?: string;
  startDate?: string;
  endDate?: string;
  instructions?: string;
}

export interface Treatment {
  treatmentText: string;
  procedureName?: string;
  outcome?: string;
}

export interface VaccinationRecord {
  vaccineName: string;
  administeredAt?: string;
  nextDueDate?: string;
  manufacturer?: string;
  batchNumber?: string;
  dose?: string;
}

export interface Veterinarian {
  id: string;
  name: string;
  email: string;
  phone?: string;
  licenseNumber?: string;
  clinic?: {
    name: string;
    address?: string;
    phone?: string;
  };
}

export interface MedicalRecord {
  id: string;
  petId: string;
  vetId: string;
  type: MedicalRecordType;
  diagnosis?: string;
  treatment?: string;
  notes?: string;
  visitDate: string;
  nextVisitDate?: string;
  createdAt: string;
  updatedAt: string;

  // Extended fields for rich medical record data
  diagnosisDetails?: Diagnosis;
  treatmentDetails?: Treatment;
  prescriptions?: Prescription[];
  vaccinations?: VaccinationRecord[];
  documents?: MedicalDocumentMetadata[];
  veterinarian?: Veterinarian;

  // Blockchain fields
  hash?: string;
  recordHash?: string;
  txHash?: string;
  blockchainTxHash?: string;
  isBlockchainVerified?: boolean;
  blockchainVerifiedAt?: string;
}

export interface CreateMedicalRecordData {
  petId: string;
  vetId: string;
  type: MedicalRecordType;
  diagnosis?: string;
  treatment?: string;
  notes?: string;
  visitDate: string;
  nextVisitDate?: string;

  // Optional rich data
  diagnosisDetails?: Diagnosis;
  treatmentDetails?: Treatment;
  prescriptions?: Prescription[];
  vaccinations?: VaccinationRecord[];
  documents?: MedicalDocumentMetadata[];
}

export interface UpdateMedicalRecordData {
  type?: MedicalRecordType;
  diagnosis?: string;
  treatment?: string;
  notes?: string;
  visitDate?: string;
  nextVisitDate?: string;

  // Optional rich data
  diagnosisDetails?: Diagnosis;
  treatmentDetails?: Treatment;
  prescriptions?: Prescription[];
  vaccinations?: VaccinationRecord[];
  documents?: MedicalDocumentMetadata[];
}

export interface MedicalRecordQuery {
  petId?: string;
  vetId?: string;
  type?: MedicalRecordType;
  startDate?: string;
  endDate?: string;
  hasBlockchainVerification?: boolean;
}

export interface MedicalRecordWithBlockchain extends MedicalRecord {
  blockchainVerification?: {
    verified: boolean;
    onChainHash?: string;
    txHash?: string;
    timestamp?: string;
    ledger?: number;
  };
}
