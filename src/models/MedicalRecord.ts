/**
 * Medical record domain models.
 *
 * These types are designed to:
 * - Represent the richer medical record domain used in the mobile app UI.
 * - Remain compatible with the current backend API schema (see `backend/types/api.ts`).
 */

/**
 * Supported medical record categories.
 *
 * Note: The backend currently uses `type` with values:
 * `checkup | vaccination | surgery | treatment | other`.
 */
export type MedicalRecordType = 'checkup' | 'vaccination' | 'surgery' | 'treatment' | 'other';

/**
 * File types supported for attached medical documents.
 */
export type MedicalDocumentType = 'pdf' | 'image' | 'other';

/**
 * Metadata for a document attached to a medical record (e.g., lab result PDF, scan image).
 */
export interface MedicalDocumentMetadata {
  /** Unique document identifier (if the backend stores documents separately). */
  id: string;

  /** Human-friendly file name. */
  name: string;

  /** MIME type, e.g. `application/pdf`, `image/jpeg`. */
  mimeType: string;

  /** Document category. */
  type: MedicalDocumentType;

  /** Public URL or signed URL where the document can be downloaded/viewed. */
  url: string;

  /** File size in bytes (if known). */
  sizeBytes?: number;

  /** When the document was uploaded/attached. */
  createdAt?: string;
}

/**
 * A diagnosis entry.
 *
 * The backend currently exposes `diagnosis?: string` on medical records.
 * This type allows a richer structure while keeping `diagnosisText` available
 * for API compatibility.
 */
export interface Diagnosis {
  /** Primary diagnosis text (API-compatible). */
  diagnosisText: string;

  /** Optional standardized code, if used (ICD/SNOMED/etc.). */
  code?: string;

  /** Optional severity indicator. */
  severity?: 'mild' | 'moderate' | 'severe' | 'unknown';
}

/**
 * A prescribed medication entry.
 */
export interface Prescription {
  /** Unique prescription identifier (if persisted separately). */
  id?: string;

  /** Medication name. */
  medicationName: string;

  /** Dosage instructions, e.g. "5mg" or "2 tablets". */
  dosage?: string;

  /** Administration route, e.g. oral, topical, injection. */
  route?: string;

  /** How often to administer, e.g. "every 12 hours". */
  frequency?: string;

  /** Start date ISO string (if applicable). */
  startDate?: string;

  /** End date ISO string (if applicable). */
  endDate?: string;

  /** Free-form additional instructions. */
  instructions?: string;
}

/**
 * A treatment entry performed or prescribed during the visit.
 *
 * The backend currently exposes `treatment?: string` on medical records.
 * This type allows a structured version while keeping `treatmentText` available
 * for API compatibility.
 */
export interface Treatment {
  /** Primary treatment text (API-compatible). */
  treatmentText: string;

  /** Optional procedure name, if applicable. */
  procedureName?: string;

  /** Optional outcomes or follow-up notes. */
  outcome?: string;
}

/**
 * Vaccination details for a vaccination record.
 */
export interface VaccinationRecord {
  /** Vaccine name (e.g., Rabies, DHPP). */
  vaccineName: string;

  /** ISO string of administration date (usually matches record `date`). */
  administeredAt?: string;

  /** Optional due date for the next dose/booster. */
  nextDueDate?: string;

  /** Optional manufacturer. */
  manufacturer?: string;

  /** Optional vaccine batch/lot number. */
  batchNumber?: string;

  /** Optional dose (e.g., mL). */
  dose?: string;
}

/**
 * Backend API representation of a medical record.
 *
 * Source: `backend/types/api.ts`
 * - `type` is the record category
 * - `visitDate` is the date/time of the visit (ISO string)
 */
export interface MedicalRecordApi {
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
}

/**
 * Blockchain verification status for a medical record.
 */
export type VerificationStatus = 'pending' | 'verified' | 'failed' | 'unknown';

/**
 * Medical record domain model with optional blockchain verification data.
 */
export interface MedicalRecord {
  /** Unique record identifier. */
  id: string;

  /** Pet identifier the record belongs to. */
  petId: string;

  /** Record category. Maps to backend `type`. */
  recordType: MedicalRecordType;

  /** ISO date string for the visit/record. Maps to backend `visitDate`. */
  date: string;

  /** Veterinarian identifier responsible for the visit. Maps to backend `vetId`. */
  vetId: string;

  /** Optional diagnosis details. */
  diagnosis?: Diagnosis;

  /** Optional treatment details. */
  treatment?: Treatment;

  /** Optional prescriptions issued during the visit. */
  prescriptions?: Prescription[];

  /** Optional vaccination details (for vaccination records). */
  vaccinations?: VaccinationRecord[];

  /** Optional medical documents attached to the record. */
  documents?: MedicalDocumentMetadata[];

  /** Veterinarian information for the record. */
  veterinarian?: {
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
  };

  /** Free-form notes. */
  notes?: string;

  /** When this record was created. */
  createdAt: string;

  /** When this record was last updated. */
  updatedAt: string;

  /** Next suggested visit date (if any). */
  nextVisitDate?: string;

  // ========================
  // Blockchain Verification
  // ========================

  /**
   * Verification status indicating whether the record's hash matches
   * the version stored on the Stellar blockchain.
   *
   * - `verified`: Record hash matches on-chain hash (tamper-evident)
   * - `pending`: Record is queued for blockchain storage but not yet confirmed
   * - `failed`: Hash mismatch — record may have been altered after creation
   * - `unknown`: Verification not yet performed (default for older records)
   */
  verificationStatus?: VerificationStatus;

  /**
   * Transaction hash from the Stellar ledger where this record's hash was stored.
   * Populated after successful blockchain storage.
   */
  blockchainTxHash?: string;

  /**
   * The cryptographic hash (SHA-256) of the record that is/was stored on-chain.
   * Used to verify integrity by comparing with on-chain value.
   */
  blockchainHash?: string;

  /**
   * ISO timestamp of the last verification attempt.
   */
  verifiedAt?: string;

  /**
   * Error message if verification failed (for `failed` status).
   */
  verificationError?: string;
}

/**
 * Convenience union for records that may include vaccination information.
 */
export type MedicalRecordWithVaccinations = MedicalRecord & {
  recordType: 'vaccination';
  vaccinations: VaccinationRecord[];
};
