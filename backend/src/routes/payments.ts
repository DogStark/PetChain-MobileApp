import { Router, type Request, type Response } from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import {
  createPaymentIntent,
  processRefund,
  streamPayment,
  type PaymentIntent,
} from '../../services/stellarPaymentService';

const router = Router();

type StoredIntent = PaymentIntent & {
  id: string;
  userId: string;
  status: 'pending' | 'confirmed' | 'partial' | 'overpaid' | 'expired';
  amountReceived?: string;
  txHash?: string;
};

const intents = new Map<string, StoredIntent>();

router.use(authenticateJWT);

router.post('/xlm/intent', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const intent = createPaymentIntent(userId);

  intents.set(intent.transactionId, {
    ...intent,
    id: intent.transactionId,
    userId,
    status: 'pending',
  });

  return res.status(201).json(intent);
});

router.post('/xlm/confirm', async (req: AuthenticatedRequest, res: Response) => {
  const { transactionId } = req.body as { transactionId?: string };
  const userId = req.user!.id;

  if (!transactionId) {
    return res.status(400).json({ error: 'transactionId is required' });
  }

  const intent = intents.get(transactionId);
  if (!intent || intent.userId !== userId || intent.status !== 'pending') {
    return res.status(404).json({ error: 'Intent not found' });
  }

  if (new Date() > intent.expiresAt) {
    intent.status = 'expired';
    return res.status(410).json({ error: 'Payment intent expired' });
  }

  const close = streamPayment(
    intent,
    (result) => {
      intent.status = result.status;
      intent.amountReceived = result.amountReceived;
      intent.txHash = result.txHash;
      close();
    },
    () => close(),
  );

  return res.json({ message: 'Payment monitoring active', transactionId });
});

router.post('/xlm/refund', async (req: Request, res: Response) => {
  const { walletAddress, amountXlm } = req.body as {
    walletAddress?: string;
    amountXlm?: string;
  };

  if (!walletAddress || !amountXlm) {
    return res.status(400).json({ error: 'walletAddress and amountXlm are required' });
  }

  const txHash = await processRefund(walletAddress, amountXlm);
  return res.json({ refunded: true, txHash });
});

export default router;
