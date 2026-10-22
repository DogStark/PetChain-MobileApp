/**
 * Travel Health Certificate Service
 * Issue #123 — Pet Travel Health Certificate Generator
 *
 * Handles:
 * - Checking pet health records against destination country requirements
 * - Generating travel health certificates via the backend
 * - Anchoring certificates to the Stellar blockchain
 */

import apiClient from './apiClient';
import type {
  TravelHealthCertificate,
  GenerateCertificateRequest,
  GenerateCertificateResponse,
  CertificateRequirementCheck,
} from '../models/TravelCertificate';

export class TravelCertificateError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'TravelCertificateError';
  }
}

// ─── API calls ────────────────────────────────────────────────────────────────

/** Generate a travel health certificate for a pet traveling to a destination country */
export async function generateTravelCertificate(
  req: GenerateCertificateRequest,
): Promise<GenerateCertificateResponse> {
  try {
    const res = await apiClient.post<{ success: boolean; data: GenerateCertificateResponse }>(
      '/travel-certificates/generate',
      req,
    );
    return res.data.data;
  } catch (error) {
    throw new TravelCertificateError('Failed to generate travel certificate', 'GENERATE_FAILED');
  }
}

/** Fetch all travel certificates for a pet */
export async function getPetTravelCertificates(petId: string): Promise<TravelHealthCertificate[]> {
  try {
    const res = await apiClient.get<{ success: boolean; data: TravelHealthCertificate[] }>(
      `/travel-certificates/pet/${petId}`,
    );
    return res.data.data;
  } catch {
    throw new TravelCertificateError('Failed to fetch travel certificates', 'FETCH_FAILED');
  }
}

/** Fetch a single certificate by ID */
export async function getTravelCertificate(
  certificateId: string,
): Promise<TravelHealthCertificate> {
  try {
    const res = await apiClient.get<{ success: boolean; data: TravelHealthCertificate }>(
      `/travel-certificates/${certificateId}`,
    );
    return res.data.data;
  } catch {
    throw new TravelCertificateError('Failed to fetch travel certificate', 'FETCH_FAILED');
  }
}

/** Anchor a certificate to the Stellar blockchain */
export async function anchorCertificateToBlockchain(
  certificateId: string,
): Promise<TravelHealthCertificate> {
  try {
    const res = await apiClient.post<{ success: boolean; data: TravelHealthCertificate }>(
      `/travel-certificates/${certificateId}/anchor`,
    );
    return res.data.data;
  } catch {
    throw new TravelCertificateError('Failed to anchor certificate to blockchain', 'ANCHOR_FAILED');
  }
}

/** Download the PDF for a certificate — returns a signed URL */
export async function getCertificatePdfUrl(certificateId: string): Promise<string> {
  try {
    const res = await apiClient.get<{ success: boolean; data: { pdfUrl: string } }>(
      `/travel-certificates/${certificateId}/pdf`,
    );
    return res.data.data.pdfUrl;
  } catch {
    throw new TravelCertificateError('Failed to get certificate PDF', 'PDF_FAILED');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns only the unmet mandatory requirements from a certificate */
export function getMissingRequirements(
  certificate: TravelHealthCertificate,
): CertificateRequirementCheck[] {
  return certificate.requirementChecks.filter((c) => !c.met);
}

/** Returns a human-readable compliance summary */
export function getComplianceSummary(certificate: TravelHealthCertificate): string {
  const total = certificate.requirementChecks.length;
  const met = certificate.requirementChecks.filter((c) => c.met).length;
  return `${met}/${total} requirements met (${certificate.complianceScore}%)`;
}
