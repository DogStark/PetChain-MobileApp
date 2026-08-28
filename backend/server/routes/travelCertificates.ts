/**
 * Travel Certificate Routes
 * Issue #123 — Pet Travel Health Certificate Generator
 *
 * POST   /travel-certificates/generate          — generate a certificate
 * GET    /travel-certificates/countries          — list supported countries
 * GET    /travel-certificates/pet/:petId         — list certificates for a pet
 * GET    /travel-certificates/:id                — get a single certificate
 * POST   /travel-certificates/:id/anchor         — anchor to Stellar blockchain
 * GET    /travel-certificates/:id/pdf            — get PDF HTML content
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import travelCertificateService from '../../services/travelCertificateService';
import { ok, sendError } from '../response';
import { store } from '../store';

const router = express.Router();

router.use(authenticateJWT);

// ── List supported countries ──────────────────────────────────────────────────
router.get('/countries', (_req, res) => {
  const countries = travelCertificateService.getSupportedCountries();
  return res.json(ok(countries));
});

// ── Generate certificate ──────────────────────────────────────────────────────
router.post('/generate', async (req: AuthenticatedRequest, res) => {
  const { petId, destinationCountryCode, travelDate } = req.body as {
    petId?: string;
    destinationCountryCode?: string;
    travelDate?: string;
  };

  if (!petId?.trim() || !destinationCountryCode?.trim() || !travelDate?.trim()) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'petId, destinationCountryCode, and travelDate are required',
    );
  }

  // Owners can only generate certificates for their own pets
  const pet = store.pets.get(petId.trim());
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');

  if (req.user!.role === UserRole.OWNER && req.user!.id !== pet.ownerId) {
    return sendError(
      res,
      403,
      'FORBIDDEN',
      'You do not have permission to generate a certificate for this pet',
    );
  }

  try {
    const certificate = await travelCertificateService.generate({
      petId: petId.trim(),
      destinationCountryCode: destinationCountryCode.trim().toUpperCase(),
      travelDate: travelDate.trim(),
    });

    const missingRequirements = certificate.requirementChecks.filter((c) => !c.met);

    return res
      .status(201)
      .json(ok({ certificate, missingRequirements }, 'Travel health certificate generated'));
  } catch (error) {
    return sendError(
      res,
      422,
      'CERTIFICATE_GENERATION_FAILED',
      error instanceof Error ? error.message : 'Failed to generate certificate',
    );
  }
});

// ── List certificates for a pet ───────────────────────────────────────────────
router.get('/pet/:petId', (req: AuthenticatedRequest, res) => {
  const { petId } = req.params;
  const pet = store.pets.get(petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found');

  if (req.user!.role === UserRole.OWNER && req.user!.id !== pet.ownerId) {
    return sendError(
      res,
      403,
      'FORBIDDEN',
      'You do not have permission to view these certificates',
    );
  }

  const certs = [...store.travelCertificates.values()]
    .filter((c) => c.petId === petId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return res.json(ok(certs));
});

// ── Get single certificate ────────────────────────────────────────────────────
router.get('/:id', (req: AuthenticatedRequest, res) => {
  const cert = store.travelCertificates.get(req.params.id);
  if (!cert) return sendError(res, 404, 'NOT_FOUND', 'Certificate not found');

  const pet = store.pets.get(cert.petId);
  if (pet && req.user!.role === UserRole.OWNER && req.user!.id !== pet.ownerId) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to view this certificate');
  }

  return res.json(ok(cert));
});

// ── Anchor to Stellar blockchain ──────────────────────────────────────────────
router.post('/:id/anchor', async (req: AuthenticatedRequest, res) => {
  const cert = store.travelCertificates.get(req.params.id);
  if (!cert) return sendError(res, 404, 'NOT_FOUND', 'Certificate not found');

  const pet = store.pets.get(cert.petId);
  if (pet && req.user!.role === UserRole.OWNER && req.user!.id !== pet.ownerId) {
    return sendError(
      res,
      403,
      'FORBIDDEN',
      'You do not have permission to anchor this certificate',
    );
  }

  try {
    const updated = await travelCertificateService.anchorToBlockchain(req.params.id);
    return res.json(ok(updated, 'Certificate anchored to Stellar blockchain'));
  } catch (error) {
    return sendError(
      res,
      502,
      'ANCHOR_FAILED',
      error instanceof Error ? error.message : 'Failed to anchor certificate',
    );
  }
});

// ── Get PDF (HTML) ────────────────────────────────────────────────────────────
router.get('/:id/pdf', (req: AuthenticatedRequest, res) => {
  const cert = store.travelCertificates.get(req.params.id);
  if (!cert) return sendError(res, 404, 'NOT_FOUND', 'Certificate not found');

  const pet = store.pets.get(cert.petId);
  if (pet && req.user!.role === UserRole.OWNER && req.user!.id !== pet.ownerId) {
    return sendError(
      res,
      403,
      'FORBIDDEN',
      'You do not have permission to download this certificate',
    );
  }

  const html = travelCertificateService.generateCertificateHtml(cert);
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Content-Disposition', `attachment; filename="travel-certificate-${cert.id}.html"`);
  return res.send(html);
});

export default router;
