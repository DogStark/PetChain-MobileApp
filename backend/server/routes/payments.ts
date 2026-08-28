/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Payment routes — FUTURE FEATURE
 * Architecture is in place; actual provider integration is stubbed.
 */

import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import type { PaymentProvider, SubscriptionPlan } from '../../models/Payment';
import paymentService from '../../services/paymentService';
import stellarPathPaymentService from '../../services/stellarPathPaymentService';
import { ok, sendError } from '../response';

const router = express.Router();

router.use(authenticateJWT);

// GET /api/payments/plans — list all subscription plans (public within auth)
router.get('/plans', (_req, res) => {
  return res.json(ok(paymentService.getPlans()));
});

// GET /api/payments/subscription — get current user's active subscription
router.get('/subscription', (req: AuthenticatedRequest, res) => {
  const sub = paymentService.getSubscription(req.user!.id);
  return res.json(ok(sub));
});

// POST /api/payments/initiate — create a pending payment intent
router.post('/initiate', (req: AuthenticatedRequest, res) => {
  const { plan, provider } = req.body as {
    plan?: SubscriptionPlan;
    provider?: PaymentProvider;
    providerTransactionId?: string;
  };

  if (!plan || !provider) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'plan and provider are required');
  }

  const validPlans: SubscriptionPlan[] = ['premium_monthly', 'premium_annual'];
  if (!validPlans.includes(plan)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `plan must be one of: ${validPlans.join(', ')}`);
  }

  const validProviders: PaymentProvider[] = [
    'stripe',
    'apple_iap',
    'google_play',
    'stub',
    'stellar_path',
  ];
  if (!validProviders.includes(provider)) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      `provider must be one of: ${validProviders.join(', ')}`,
    );
  }

  try {
    const payment = paymentService.initiatePayment({
      userId: req.user!.id,
      plan,
      provider,
      providerTransactionId: (req.body as Record<string, string | undefined>).providerTransactionId,
    });
    return res.status(201).json(ok(payment, 'Payment initiated'));
  } catch (err) {
    return sendError(
      res,
      500,
      'PAYMENT_ERROR',
      err instanceof Error ? err.message : 'Failed to initiate payment',
    );
  }
});

// POST /api/payments/:paymentId/confirm — confirm and activate subscription
router.post('/:paymentId/confirm', (req: AuthenticatedRequest, res) => {
  try {
    const result = paymentService.confirmPayment(req.params.paymentId);
    return res.json(ok(result, 'Payment confirmed and subscription activated'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to confirm payment';
    const status = msg === 'Payment not found' ? 404 : 400;
    return sendError(res, status, 'PAYMENT_ERROR', msg);
  }
});

// DELETE /api/payments/subscription — cancel subscription at period end
router.delete('/subscription', (req: AuthenticatedRequest, res) => {
  try {
    const sub = paymentService.cancelSubscription(req.user!.id);
    return res.json(ok(sub, 'Subscription will be cancelled at the end of the current period'));
  } catch (err) {
    return sendError(
      res,
      404,
      'NOT_FOUND',
      err instanceof Error ? err.message : 'Subscription not found',
    );
  }
});

// GET /api/payments/history — payment history for current user
router.get('/history', (req: AuthenticatedRequest, res) => {
  const history = paymentService.getPaymentHistory(req.user!.id);
  return res.json(ok(history));
});

router.post('/stellar/prepare', async (req: AuthenticatedRequest, res) => {
  const { plan, sourceAssetCode, sourceAssetIssuer, sourceAssetType, sourceAccountPublicKey } =
    req.body as {
      plan?: SubscriptionPlan;
      sourceAssetCode?: string;
      sourceAssetIssuer?: string;
      sourceAssetType?: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
      sourceAccountPublicKey?: string;
    };

  if (!plan || !sourceAssetCode || !sourceAccountPublicKey) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'plan, sourceAssetCode, and sourceAccountPublicKey are required',
    );
  }

  try {
    const result = await stellarPathPaymentService.preparePayment({
      userId: req.user!.id,
      plan,
      sourceAsset: {
        code: sourceAssetCode,
        issuer: sourceAssetIssuer,
        type: sourceAssetType,
      },
      sourceAccount: sourceAccountPublicKey,
    });
    return res.status(201).json(ok(result, 'Stellar path payment prepared'));
  } catch (err) {
    return sendError(
      res,
      400,
      'PAYMENT_ERROR',
      err instanceof Error ? err.message : 'Failed to prepare Stellar payment',
    );
  }
});

router.post('/stellar/submit', async (req: AuthenticatedRequest, res) => {
  const { paymentId, signedTransactionXdr } = req.body as {
    paymentId?: string;
    signedTransactionXdr?: string;
  };

  if (!paymentId?.trim() || !signedTransactionXdr?.trim()) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'paymentId and signedTransactionXdr are required',
    );
  }

  try {
    const result = await stellarPathPaymentService.submitPayment({
      paymentId: paymentId.trim(),
      signedTransactionXdr: signedTransactionXdr.trim(),
    });
    return res.json(ok(result, 'Stellar payment confirmed and subscription activated'));
  } catch (err) {
    return sendError(
      res,
      400,
      'PAYMENT_ERROR',
      err instanceof Error ? err.message : 'Failed to submit Stellar payment',
    );
  }
});

router.get('/stellar/audits', (req: AuthenticatedRequest, res) => {
  const paymentId = (req.query.paymentId as string | undefined)?.trim();
  const audits = stellarPathPaymentService.getAudits(paymentId);
  return res.json(ok(audits));
});

export default router;
