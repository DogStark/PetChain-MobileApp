import express from 'express';
import request from 'supertest';

jest.mock('../../src/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../src/services/moderationService', () => ({
  isLikelySpam: jest.fn(() => false),
}));

import { query } from '../../src/db';
import forumRouter from '../forum';

const app = express();
app.use(express.json());
app.use('/api/forum', forumRouter);

describe('forum route', () => {
  beforeEach(() => {
    (query as jest.Mock).mockReset();
  });

  it('records a vote and updates answer score', async () => {
    (query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .post('/api/forum/answers/123/vote')
      .send({ user_id: 'user-1', delta: 1 });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO forum_votes (answer_id, user_id, delta) VALUES ($1,$2,$3) ON CONFLICT (answer_id,user_id) DO UPDATE SET delta = EXCLUDED.delta',
      ['123', 'user-1', 1],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      'UPDATE forum_answers SET votes = (SELECT COALESCE(SUM(delta),0) FROM forum_votes WHERE answer_id = $1) WHERE id = $1',
      ['123'],
    );
    expect(query).toHaveBeenNthCalledWith(4, 'COMMIT');
  });

  it('rejects invalid vote delta', async () => {
    const response = await request(app)
      .post('/api/forum/answers/123/vote')
      .send({ user_id: 'user-1', delta: 5 });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
