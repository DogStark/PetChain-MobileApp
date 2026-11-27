import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { logAuditTrail } from '../../middleware/auditLogger';
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

router.post('/redeem', async (req: AuthenticatedRequest, res) => {
  const { amount, invoiceTotal } = req.body as {
    amount?: number;
    invoiceTotal?: number;
  };
  const idempotencyKey = req.header('Idempotency-Key') ?? (req.body as { idempotencyKey?: string }).idempotencyKey;

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'amount must be a positive number');
  }
  if (!idempotencyKey?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Idempotency-Key header is required');
  }
  if (invoiceTotal !== undefined && (typeof invoiceTotal !== 'number' || !Number.isFinite(invoiceTotal) || invoiceTotal < 0)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'invoiceTotal must be a non-negative number');
  }

  try {
    const redemption = referralService.redeemReferralCredits({
      userId: req.user!.id,
      amount,
      idempotencyKey,
      invoiceTotal,
    });

    if (!redemption.replayed) {
      void logAuditTrail({
        req,
        entityType: 'referral_redemption',
        entityId: redemption.redemptionId,
        action: 'CREATE',
        before: null,
        after: redemption,
      });
    }

    return res.status(redemption.replayed ? 200 : 201).json(ok(redemption, 'Referral credits redeemed'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to redeem referral credits';
    if (message.includes('Idempotency key was already used')) {
      return sendError(res, 409, 'IDEMPOTENCY_CONFLICT', message);
    }
    if (message.includes('exceeds invoice total')) {
      return sendError(res, 422, 'OVER_REDEMPTION', message);
    }
    if (message.includes('No referral credits available')) {
      return sendError(res, 409, 'NO_CREDITS', message);
    }
    return sendError(res, 400, 'REDEMPTION_INVALID', message);
  }
});

export default router;
