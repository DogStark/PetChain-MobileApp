import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import referralService from '../../services/referralService';
import { ok, sendError } from '../response';

const router = express.Router();

router.use(authenticateJWT);

router.get('/me', (req: AuthenticatedRequest, res) => {
  return res.json(ok(referralService.getReferralStats(req.user!.id)));
});

router.post('/apply', (req: AuthenticatedRequest, res) => {
  const { referralCode, deviceFingerprint } = req.body as {
    referralCode?: string;
    deviceFingerprint?: string;
  };

  if (!referralCode?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'referralCode is required');
  }

  try {
    const referral = referralService.createPendingReferral(referralCode, req.user!.id, {
      deviceFingerprint,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    if (referral.status === 'blocked') {
      return sendError(
        res,
        403,
        'REFERRAL_BLOCKED',
        referral.blockReason ?? 'Referral failed fraud checks',
      );
    }

    return res.status(201).json(ok(referral, 'Referral applied'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to apply referral code';
    const status = message.includes('not found') ? 404 : 400;
    return sendError(res, status, 'REFERRAL_INVALID', message);
  }
});

export default router;
