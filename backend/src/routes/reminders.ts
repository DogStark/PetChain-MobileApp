import { Router } from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';

const router = Router();

interface SnoozeRecord {
  reminderId: string;
  userId: string;
  durationMinutes: number;
  snoozeUntil: Date;
}

const snoozeRecords: SnoozeRecord[] = [];

router.use(authenticateJWT);

router.post('/snooze', async (req: AuthenticatedRequest, res) => {
  const { reminderId, durationMinutes, snoozeUntil } = req.body as {
    reminderId?: string;
    durationMinutes?: number;
    snoozeUntil?: string;
  };

  if (!reminderId || !durationMinutes || !snoozeUntil) {
    return res
      .status(400)
      .json({ error: 'reminderId, durationMinutes, and snoozeUntil are required' });
  }

  snoozeRecords.push({
    reminderId,
    userId: req.user!.id,
    durationMinutes,
    snoozeUntil: new Date(snoozeUntil),
  });

  return res.json({ ok: true });
});

router.get('/:reminderId/suggested-time', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { reminderId } = req.params;

  const records = snoozeRecords
    .filter((record) => record.reminderId === reminderId && record.userId === userId)
    .sort((a, b) => b.snoozeUntil.getTime() - a.snoozeUntil.getTime())
    .slice(0, 30);

  if (records.length < 5) {
    return res.json({ suggestedHour: null });
  }

  const freq: Record<number, number> = {};
  for (const record of records) {
    const hour = record.snoozeUntil.getHours();
    freq[hour] = (freq[hour] || 0) + 1;
  }

  const suggestedHour = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);

  return res.json({ suggestedHour });
});

export default router;
