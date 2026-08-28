/**
 * Travel Certificate Service — backend
 * Issue #123 — Pet Travel Health Certificate Generator
 *
 * Responsibilities:
 * - Check pet health records against destination country requirements
 * - Generate a formatted travel health certificate (PDF via HTML template)
 * - Anchor the certificate to Stellar blockchain
 */

import { randomUUID } from 'crypto';

import stellarAnchorService from './stellarService';
import { getCountryRequirements, getSupportedCountries } from '../data/countryTravelRequirements';
import { store, type StoredTravelCertificate } from '../server/store';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequirementCheck {
  requirementType: 'vaccination' | 'health_check' | 'document';
  requirementName: string;
  met: boolean;
  details?: string;
  satisfiedAt?: string;
  actionRequired?: string;
}

interface GenerateInput {
  petId: string;
  destinationCountryCode: string;
  travelDate: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function weeksAgo(isoDate: string): number {
  const ms = Date.now() - new Date(isoDate).getTime();
  return ms / (1000 * 60 * 60 * 24 * 7);
}

function monthsAgo(isoDate: string): number {
  const ms = Date.now() - new Date(isoDate).getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.44);
}

function daysUntilTravel(travelDate: string): number {
  const ms = new Date(travelDate).getTime() - Date.now();
  return ms / (1000 * 60 * 60 * 24);
}

// ─── Core service ─────────────────────────────────────────────────────────────

export class TravelCertificateService {
  /**
   * Generate a travel health certificate by checking the pet's records
   * against the destination country's requirements.
   */
  async generate(input: GenerateInput): Promise<StoredTravelCertificate> {
    const { petId, destinationCountryCode, travelDate } = input;

    const pet = store.pets.get(petId);
    if (!pet) throw new Error('Pet not found');

    const countryReqs = getCountryRequirements(destinationCountryCode, pet.species);
    if (!countryReqs) {
      throw new Error(
        `No travel requirements found for country "${destinationCountryCode}" and species "${pet.species}"`,
      );
    }

    // Gather pet's medical records
    const petRecords = [...store.medicalRecords.values()].filter((r) => r.petId === petId);
    const vaccinationRecords = petRecords.filter((r) => r.type === 'vaccination');

    const checks: RequirementCheck[] = [];

    // ── Check vaccinations ──────────────────────────────────────────────────
    for (const req of countryReqs.vaccinations) {
      const match = vaccinationRecords.find(
        (r) =>
          r.treatment?.toLowerCase().includes(req.vaccineName.toLowerCase()) ||
          r.diagnosis?.toLowerCase().includes(req.vaccineName.toLowerCase()) ||
          r.notes?.toLowerCase().includes(req.vaccineName.toLowerCase()),
      );

      if (!match) {
        checks.push({
          requirementType: 'vaccination',
          requirementName: req.vaccineName,
          met: false,
          actionRequired: `Schedule a ${req.vaccineName} vaccination with your vet${req.minWeeksBeforeTravel ? ` at least ${req.minWeeksBeforeTravel} weeks before travel` : ''}.`,
        });
        continue;
      }

      // Check timing constraints
      const weeksAgoAdministered = weeksAgo(match.visitDate);
      const monthsAgoAdministered = monthsAgo(match.visitDate);

      if (req.minWeeksBeforeTravel && weeksAgoAdministered < req.minWeeksBeforeTravel) {
        const daysLeft = Math.ceil((req.minWeeksBeforeTravel - weeksAgoAdministered) * 7);
        checks.push({
          requirementType: 'vaccination',
          requirementName: req.vaccineName,
          met: false,
          details: `Vaccination administered ${Math.floor(weeksAgoAdministered)} weeks ago; must be at least ${req.minWeeksBeforeTravel} weeks before travel.`,
          satisfiedAt: match.visitDate,
          actionRequired: `Wait ${daysLeft} more days before traveling, or re-vaccinate.`,
        });
        continue;
      }

      if (req.validForMonths && monthsAgoAdministered > req.validForMonths) {
        checks.push({
          requirementType: 'vaccination',
          requirementName: req.vaccineName,
          met: false,
          details: `Vaccination expired (administered ${Math.floor(monthsAgoAdministered)} months ago; valid for ${req.validForMonths} months).`,
          satisfiedAt: match.visitDate,
          actionRequired: `Renew the ${req.vaccineName} vaccination before travel.`,
        });
        continue;
      }

      checks.push({
        requirementType: 'vaccination',
        requirementName: req.vaccineName,
        met: true,
        details: `Administered on ${new Date(match.visitDate).toLocaleDateString()}`,
        satisfiedAt: match.visitDate,
      });
    }

    // ── Check health checks ─────────────────────────────────────────────────
    for (const req of countryReqs.healthChecks) {
      // Microchip: check pet record
      if (req.checkType === 'microchip') {
        const hasMicrochip = Boolean(pet.microchipId);
        checks.push({
          requirementType: 'health_check',
          requirementName: req.description,
          met: hasMicrochip,
          details: hasMicrochip ? `Microchip ID: ${pet.microchipId}` : undefined,
          actionRequired: hasMicrochip
            ? undefined
            : 'Have your vet implant an ISO 11784/11785 compliant microchip.',
        });
        continue;
      }

      // General health exam / other checks: look for a recent checkup record
      const recentCheckup = petRecords
        .filter((r) => r.type === 'checkup' || r.type === 'treatment')
        .sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime())[0];

      if (!recentCheckup) {
        checks.push({
          requirementType: 'health_check',
          requirementName: req.description,
          met: false,
          actionRequired: `Schedule a veterinary ${req.checkType.replace(/_/g, ' ')} before travel.`,
        });
        continue;
      }

      if (req.maxDaysBeforeTravel) {
        const daysUntil = daysUntilTravel(travelDate);
        const daysSinceCheck =
          (Date.now() - new Date(recentCheckup.visitDate).getTime()) / (1000 * 60 * 60 * 24);
        const effectiveDaysBeforeTravel = daysSinceCheck + daysUntil;

        if (effectiveDaysBeforeTravel > req.maxDaysBeforeTravel) {
          checks.push({
            requirementType: 'health_check',
            requirementName: req.description,
            met: false,
            details: `Last check was ${Math.floor(daysSinceCheck)} days ago; must be within ${req.maxDaysBeforeTravel} days of travel.`,
            actionRequired: `Schedule a ${req.checkType.replace(/_/g, ' ')} within ${req.maxDaysBeforeTravel} days of your travel date.`,
          });
          continue;
        }
      }

      checks.push({
        requirementType: 'health_check',
        requirementName: req.description,
        met: true,
        details: `Completed on ${new Date(recentCheckup.visitDate).toLocaleDateString()}`,
        satisfiedAt: recentCheckup.visitDate,
      });
    }

    // ── Check documents ─────────────────────────────────────────────────────
    // Documents are flagged as actionable steps — they must be obtained by the owner
    for (const req of countryReqs.documents) {
      checks.push({
        requirementType: 'document',
        requirementName: req.description,
        met: false, // Documents must be physically obtained; flagged as action items
        actionRequired: `Obtain: ${req.description}${req.issuingAuthority ? ` from ${req.issuingAuthority}` : ''}.`,
      });
    }

    // ── Compute compliance score (mandatory requirements only) ──────────────
    const mandatoryVaccChecks = checks.filter((c) => c.requirementType === 'vaccination');
    const mandatoryHealthChecks = checks.filter((c) => c.requirementType === 'health_check');
    const mandatoryChecks = [...mandatoryVaccChecks, ...mandatoryHealthChecks];
    const metCount = mandatoryChecks.filter((c) => c.met).length;
    const complianceScore =
      mandatoryChecks.length > 0 ? Math.round((metCount / mandatoryChecks.length) * 100) : 100;

    const allMandatoryMet = mandatoryChecks.every((c) => c.met);
    const status: StoredTravelCertificate['status'] = allMandatoryMet ? 'ready' : 'incomplete';

    const now = new Date().toISOString();
    const id = randomUUID();

    const certificate: StoredTravelCertificate = {
      id,
      petId,
      petName: pet.name,
      destinationCountryCode: countryReqs.countryCode,
      destinationCountryName: countryReqs.countryName,
      travelDate,
      generatedAt: now,
      status,
      requirementChecks: checks,
      complianceScore,
      isBlockchainAnchored: false,
      createdAt: now,
      updatedAt: now,
    };

    store.travelCertificates.set(id, certificate);
    return certificate;
  }

  /** Anchor a certificate to the Stellar blockchain */
  async anchorToBlockchain(certificateId: string): Promise<StoredTravelCertificate> {
    const cert = store.travelCertificates.get(certificateId);
    if (!cert) throw new Error('Certificate not found');

    const result = await stellarAnchorService.anchorRecord({
      recordId: cert.id,
      payload: cert,
      network: 'testnet',
    });

    const updated: StoredTravelCertificate = {
      ...cert,
      blockchainTxHash: result.transactionId,
      blockchainHash: result.recordHash,
      isBlockchainAnchored: result.status !== 'failed',
      blockchainAnchoredAt: new Date().toISOString(),
      status: result.status !== 'failed' ? 'anchored' : 'anchor_failed',
      updatedAt: new Date().toISOString(),
    };

    store.travelCertificates.set(cert.id, updated);
    return updated;
  }

  /** Generate a simple HTML-based PDF certificate */
  generateCertificateHtml(cert: StoredTravelCertificate): string {
    const metChecks = cert.requirementChecks.filter((c) => c.met);
    const missingChecks = cert.requirementChecks.filter((c) => !c.met);

    const checkRow = (c: (typeof cert.requirementChecks)[0]) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${c.requirementName}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-transform:capitalize;">${c.requirementType.replace('_', ' ')}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;color:${c.met ? '#16a34a' : '#dc2626'};font-weight:600;">${c.met ? '✓ Met' : '✗ Missing'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;color:#555;">${c.details ?? c.actionRequired ?? ''}</td>
      </tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Pet Travel Health Certificate</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #111; }
    h1 { color: #065f46; border-bottom: 3px solid #10b981; padding-bottom: 10px; }
    .badge { display:inline-block; padding:4px 12px; border-radius:20px; font-size:13px; font-weight:700; }
    .badge-ready { background:#d1fae5; color:#065f46; }
    .badge-incomplete { background:#fee2e2; color:#991b1b; }
    .badge-anchored { background:#dbeafe; color:#1e40af; }
    table { width:100%; border-collapse:collapse; margin-top:16px; }
    th { background:#f3f4f6; padding:10px 8px; text-align:left; font-size:13px; color:#374151; }
    .section { margin-top:28px; }
    .meta { display:flex; gap:32px; margin:16px 0; }
    .meta-item { }
    .meta-label { font-size:12px; color:#6b7280; margin-bottom:2px; }
    .meta-value { font-size:15px; font-weight:600; }
    .blockchain { margin-top:24px; padding:14px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; font-size:12px; color:#1e40af; }
    .score { font-size:28px; font-weight:700; color:${cert.complianceScore === 100 ? '#16a34a' : cert.complianceScore >= 60 ? '#d97706' : '#dc2626'}; }
    .missing-section { margin-top:24px; padding:16px; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; }
    .missing-section h3 { color:#991b1b; margin:0 0 12px; }
    .action-item { padding:6px 0; border-bottom:1px solid #fecaca; font-size:13px; }
    .action-item:last-child { border-bottom:none; }
    .disclaimer { margin-top:32px; font-size:11px; color:#9ca3af; border-top:1px solid #e5e7eb; padding-top:12px; }
  </style>
</head>
<body>
  <h1>🐾 Pet Travel Health Certificate</h1>

  <div class="meta">
    <div class="meta-item">
      <div class="meta-label">Pet Name</div>
      <div class="meta-value">${cert.petName}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Destination</div>
      <div class="meta-value">${cert.destinationCountryName} (${cert.destinationCountryCode})</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Travel Date</div>
      <div class="meta-value">${new Date(cert.travelDate).toLocaleDateString()}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Generated</div>
      <div class="meta-value">${new Date(cert.generatedAt).toLocaleString()}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Status</div>
      <div class="meta-value">
        <span class="badge badge-${cert.status}">${cert.status.toUpperCase()}</span>
      </div>
    </div>
  </div>

  <div>
    <div class="meta-label">Compliance Score</div>
    <div class="score">${cert.complianceScore}%</div>
    <div style="font-size:13px;color:#6b7280;">${metChecks.length} of ${cert.requirementChecks.length} requirements met</div>
  </div>

  <div class="section">
    <h2>Requirement Checks</h2>
    <table>
      <thead>
        <tr>
          <th>Requirement</th>
          <th>Type</th>
          <th>Status</th>
          <th>Details / Action</th>
        </tr>
      </thead>
      <tbody>
        ${cert.requirementChecks.map(checkRow).join('')}
      </tbody>
    </table>
  </div>

  ${
    missingChecks.length > 0
      ? `
  <div class="missing-section">
    <h3>⚠️ Action Required — ${missingChecks.length} Missing Requirement${missingChecks.length > 1 ? 's' : ''}</h3>
    ${missingChecks.map((c) => `<div class="action-item">• <strong>${c.requirementName}:</strong> ${c.actionRequired ?? 'Contact your vet.'}</div>`).join('')}
  </div>`
      : ''
  }

  ${
    cert.isBlockchainAnchored
      ? `
  <div class="blockchain">
    <strong>🔗 Blockchain Verified</strong><br/>
    Transaction: ${cert.blockchainTxHash}<br/>
    Anchored: ${cert.blockchainAnchoredAt ? new Date(cert.blockchainAnchoredAt).toLocaleString() : 'N/A'}<br/>
    Certificate ID: ${cert.id}
  </div>`
      : ''
  }

  <div class="disclaimer">
    This certificate was generated by PetChain and is based on the pet's recorded health data.
    Always verify requirements with official government sources before travel.
    Certificate ID: ${cert.id}
  </div>
</body>
</html>`;
  }

  getSupportedCountries() {
    return getSupportedCountries();
  }
}

export const travelCertificateService = new TravelCertificateService();
export default travelCertificateService;
