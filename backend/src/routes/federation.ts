import express from 'express';

import { authenticateJWT, authorizeRoles, type AuthenticatedRequest } from '../../middleware/auth';
import { UserRole } from '../../models/UserRole';
import { ok, sendError } from '../../server/response';
import { store } from '../../server/store';
import {
  claimFederatedAddress,
  getSignedRecord,
  getVetFederationRecord,
  lookupFederation,
  revokeVetCredential,
  signMedicalRecord,
  verifyRecordSignature,
} from '../../services/federationService';

const router = express.Router();

// ── Public: Stellar federation lookup ──────────────────────────────────────
// GET /api/federation?q=dr.smith*petchain.app&type=name
router.get('/', (req, res) => {
  const { q, type } = req.query as { q?: string; type?: string };
  if (!q || !type) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'q and type query params are required');
  }

  const record = lookupFederation(q, type);
  if (!record) {
    return sendError(res, 404, 'NOT_FOUND', 'Federation record not found');
  }

  return res.json({
    stellar_address: record.federatedAddress,
    account_id: record.stellarPublicKey,
    memo_type: 'text',
    memo: record.vetId,
  });
});

// ── Authenticated routes ────────────────────────────────────────────────────
router.use(authenticateJWT);

// POST /api/federation/claim — vet claims a federated address
router.post(
  '/claim',
  authorizeRoles(UserRole.VET, UserRole.ADMIN),
  (req: AuthenticatedRequest, res) => {
    const { username, credentialHash } = req.body as {
      username?: string;
      credentialHash?: string;
    };

    if (!username?.trim() || !credentialHash?.trim()) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'username and credentialHash are required');
    }

    if (!/^[a-z0-9._-]+$/.test(username)) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'username must be lowercase alphanumeric with . _ -',
      );
    }

    try {
      const record = claimFederatedAddress(req.user!.id, username.trim(), credentialHash.trim());
      return res.status(201).json(
        ok({
          federatedAddress: record.federatedAddress,
          stellarPublicKey: record.stellarPublicKey,
          claimedAt: record.claimedAt,
        }),
      );
    } catch (err) {
      return sendError(res, 409, 'CONFLICT', err instanceof Error ? err.message : 'Claim failed');
    }
  },
);

// GET /api/federation/me — get current vet's federation record
router.get(
  '/me',
  authorizeRoles(UserRole.VET, UserRole.ADMIN),
  (req: AuthenticatedRequest, res) => {
    const record = getVetFederationRecord(req.user!.id);
    if (!record) return sendError(res, 404, 'NOT_FOUND', 'No federation record found');
    return res.json(
      ok({
        federatedAddress: record.federatedAddress,
        stellarPublicKey: record.stellarPublicKey,
        credentialHash: record.credentialHash,
        claimedAt: record.claimedAt,
        revokedAt: record.revokedAt,
      }),
    );
  },
);

// POST /api/federation/sign/:recordId — sign a medical record
router.post(
  '/sign/:recordId',
  authorizeRoles(UserRole.VET, UserRole.ADMIN),
  (req: AuthenticatedRequest, res) => {
    const record = store.medicalRecords.get(req.params.recordId);
    if (!record) return sendError(res, 404, 'NOT_FOUND', 'Medical record not found');

    try {
      const signed = signMedicalRecord(req.params.recordId, record, req.user!.id);
      // Persist signature fields on the record
      store.medicalRecords.set(req.params.recordId, {
        ...record,
        vetSignature: signed.signature,
        vetFederatedAddress: signed.vetFederatedAddress,
        vetPublicKey: signed.vetPublicKey,
        vetSignedAt: signed.signedAt,
      });
      return res.json(ok(signed));
    } catch (err) {
      return sendError(
        res,
        400,
        'SIGN_FAILED',
        err instanceof Error ? err.message : 'Signing failed',
      );
    }
  },
);

// GET /api/federation/verify/:recordId — verify a signed medical record
router.get('/verify/:recordId', (req, res) => {
  const record = store.medicalRecords.get(req.params.recordId);
  if (!record) return sendError(res, 404, 'NOT_FOUND', 'Medical record not found');

  const signed = getSignedRecord(req.params.recordId);
  const verified = verifyRecordSignature(req.params.recordId, record);

  return res.json(
    ok({
      verified,
      signedRecord: signed,
    }),
  );
});

// DELETE /api/federation/revoke/:vetId — admin revokes a vet's credential
router.delete('/revoke/:vetId', authorizeRoles(UserRole.ADMIN), (_req, res) => {
  const vetId = _req.params.vetId;
  try {
    revokeVetCredential(vetId);
    return res.json(ok(null, `Credential revoked for vet ${vetId}`));
  } catch (err) {
    return sendError(
      res,
      400,
      'REVOKE_FAILED',
      err instanceof Error ? err.message : 'Revocation failed',
    );
  }
});

export default router;
