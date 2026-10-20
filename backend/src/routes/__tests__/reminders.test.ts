import express from 'express';
import request from 'supertest';

import { getPreferences } from '../../../services/pushService';
import remindersRouter from '../reminders';

jest.mock('../../../middleware/auth', () => ({
  authenticateJWT: (req: { user?: { id: string } }, _res: unknown, next: () => void) => {
    req.user = { id: 'reminder-owner-1' };
    next();
  },
}));

jest.mock('../../../services/pushService', () => ({
  getPreferences: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use('/api/reminders', remindersRouter);

describe('POST /api/reminders/snooze', () => {
  beforeEach(() => {
    (getPreferences as jest.Mock).mockResolvedValue({
      enabled: true,
      topics: { medication_reminders: true },
    });
  });

  it('accepts a snooze at the maximum interval when server permission is enabled', async () => {
    const response = await request(app)
      .post('/api/reminders/snooze')
      .send({
        reminderId: 'reminder-1',
        durationMinutes: 1440,
        snoozeUntil: new Date(Date.now() + 1440 * 60 * 1000).toISOString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('rejects durations above 24 hours', async () => {
    const response = await request(app)
      .post('/api/reminders/snooze')
      .send({
        reminderId: 'reminder-1',
        durationMinutes: 1441,
        snoozeUntil: new Date(Date.now() + 1441 * 60 * 1000).toISOString(),
      });

    expect(response.status).toBe(400);
  });

  it('denies snoozing when the server disables reminders', async () => {
    (getPreferences as jest.Mock).mockResolvedValue({
      enabled: false,
      topics: { medication_reminders: true },
    });

    const response = await request(app)
      .post('/api/reminders/snooze')
      .send({
        reminderId: 'reminder-1',
        durationMinutes: 15,
        snoozeUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });

    expect(response.status).toBe(403);
  });
});