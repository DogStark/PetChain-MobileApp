import { Router, type Response } from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import stellarAnchorService from '../../services/stellarAnchorService';

const router = Router();
router.use(authenticateJWT);

/**
 * POST /api/anchor/deposit
 * Initiate a SEP-24 interactive deposit.
 *
 * Body: { walletAddress: string; currency: "USD" | "EUR"; userSecret?: string }
 * Returns: { depositId, interactiveUrl, assetCode, currency }
 */
router.post('/deposit', async (req: AuthenticatedRequest, res: Response) => {
  const { walletAddress, currency, userSecret } = req.body as {
    walletAddress?: string;
    currency?: string;
    userSecret?: string;
  };

  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  if (!walletAddress || !currency) {
    return res.status(400).json({ error: 'walletAddress and currency are required' });
  }

  const SUPPORTED_CURRENCIES = ['USD', 'EUR'];
  if (!SUPPORTED_CURRENCIES.includes(currency.toUpperCase())) {
    return res
      .status(400)
      .json({ error: `Unsupported currency. Supported: ${SUPPORTED_CURRENCIES.join(', ')}` });
  }

  const result = await stellarAnchorService.initiateDeposit(
    userId,
    walletAddress,
    currency.toUpperCase(),
    userSecret,
  );

  return res.status(201).json(result);
});

/**
 * GET /api/anchor/deposit/:depositId
 * Poll the status of an existing deposit.
 *
 * Returns: DepositRecord (without sensitive fields)
 */
router.get('/deposit/:depositId', async (req: AuthenticatedRequest, res: Response) => {
  const { depositId } = req.params;
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const record = await stellarAnchorService.getDepositStatus(depositId);

  if (record.userId !== userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Strip internal anchor tx ID from the response
  const { message: _message, ...safeRecord } = record;
  return res.json(safeRecord);
});

/**
 * GET /api/anchor/deposits
 * List all deposits for the authenticated user.
 */
router.get('/deposits', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const records = stellarAnchorService.getDepositsForUser(userId).map(({ message: _m, ...r }) => r);
  return res.json(records);
});

export default router;
