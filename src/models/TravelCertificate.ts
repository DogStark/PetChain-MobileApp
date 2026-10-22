/**
 * Travel Health Certificate domain models.
 * Issue #123 — Pet Travel Health Certificate Generator
 */

// ─── Country Requirements ─────────────────────────────────────────────────────

export interface VaccinationRequirement {
  vaccineName: string;
  /** Minimum weeks before travel the vaccine must have been administered */
  minWeeksBeforeTravel?: number;
  /** Maximum months the vaccine is valid for travel */
  validForMonths?: number;
  mandatory: boolean;
  notes?: string;
}

export interface HealthCheckRequirement {
  checkType: string;
  description: string;
  /** Days before travel the check must be performed */
  maxDaysBeforeTravel?: number;
  mandatory: boolean;
}

export interface DocumentRequirement {
  documentType: string;
  description: string;
  mandatory: boolean;
  issuingAuthority?: string;
}

export interface CountryTravelRequirements {
  countryCode: string; // ISO 3166-1 alpha-2
  countryName: string;
  /** Species this requirement applies to; empty = all species */
  applicableSpecies: string[];
  vaccinations: VaccinationRequirement[];
  healthChecks: HealthCheckRequirement[];
  documents: DocumentRequirement[];
  /** ISO 8601 date when these requirements were last verified */
  lastUpdated: string;
  officialReferenceUrl?: string;
  additionalNotes?: string;
}

// ─── Certificate ──────────────────────────────────────────────────────────────

export type CertificateStatus = 'draft' | 'ready' | 'incomplete' | 'anchored' | 'anchor_failed';

export interface CertificateRequirementCheck {
  requirementType: 'vaccination' | 'health_check' | 'document';
  requirementName: string;
  met: boolean;
  details?: string;
  /** ISO date the requirement was satisfied */
  satisfiedAt?: string;
  /** Actionable step if not met */
  actionRequired?: string;
}

export interface TravelHealthCertificate {
  id: string;
  petId: string;
  petName: string;
  destinationCountryCode: string;
  destinationCountryName: string;
  /** Planned travel date (ISO date string) */
  travelDate: string;
  /** ISO timestamp when the certificate was generated */
  generatedAt: string;
  status: CertificateStatus;
  requirementChecks: CertificateRequirementCheck[];
  /** Overall compliance: percentage of mandatory requirements met */
  complianceScore: number;
  /** PDF download URL (populated after generation) */
  pdfUrl?: string;
  // Blockchain anchoring
  blockchainTxHash?: string;
  blockchainHash?: string;
  isBlockchainAnchored: boolean;
  blockchainAnchoredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateCertificateRequest {
  petId: string;
  destinationCountryCode: string;
  travelDate: string;
}

export interface GenerateCertificateResponse {
  certificate: TravelHealthCertificate;
  missingRequirements: CertificateRequirementCheck[];
  pdfUrl?: string;
}
