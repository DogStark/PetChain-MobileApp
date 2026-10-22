import express from 'express';
import type { Request, Response } from 'express';

import { query } from '../db';
import moderationService from '../services/moderationService';

const router = express.Router();

// List posts with basic pagination
router.get('/posts', async (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 20);
  const offset = Number(req.query.offset ?? 0);

  try {
    const searchTerm = String(req.query.search ?? '').trim();
    const orderBy =
      req.query.top === 'true'
        ? '(SELECT COALESCE(MAX(votes),0) FROM forum_answers WHERE post_id = forum_posts.id) DESC, created_at DESC'
        : 'created_at DESC';
    const filterSql = searchTerm
      ? 'WHERE title ILIKE $3 OR body ILIKE $3 OR species ILIKE $3 OR breed ILIKE $3'
      : '';
    const queryArgs = searchTerm ? [limit, offset, `%${searchTerm}%`] : [limit, offset];

    const { rows } = await query(
      `SELECT * FROM forum_posts ${filterSql} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
      queryArgs,
    );
    res.json({ ok: true, posts: rows });
  } catch (err) {
    console.error('forum:list error', err);
    res.status(500).json({ ok: false, error: 'Failed to list posts' });
  }
});

// Create a post
router.post('/posts', async (req: Request, res: Response) => {
  const { title, body, species, breed, author_id } = req.body;

  try {
    const isSpam = moderationService.isLikelySpam(title + '\n' + body);
    if (isSpam) return res.status(400).json({ ok: false, error: 'Content flagged as spam' });

    const { rows } = await query(
      'INSERT INTO forum_posts (title, body, species, breed, author_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [title, body, species, breed, author_id],
    );
    res.json({ ok: true, post: rows[0] });
  } catch (err) {
    console.error('forum:create error', err);
    res.status(500).json({ ok: false, error: 'Failed to create post' });
  }
});

// Get single post with answers
router.get('/posts/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  try {
    const postRes = await query('SELECT * FROM forum_posts WHERE id = $1', [id]);
    const answersRes = await query(
      'SELECT * FROM forum_answers WHERE post_id = $1 ORDER BY votes DESC, created_at DESC',
      [id],
    );
    res.json({ ok: true, post: postRes.rows[0], answers: answersRes.rows });
  } catch (err) {
    console.error('forum:get post', err);
    res.status(500).json({ ok: false, error: 'Failed to load post' });
  }
});

// Add answer
router.post('/posts/:id/answers', async (req: Request, res: Response) => {
  const postId = req.params.id;
  const { body, author_id, verified } = req.body;

  try {
    const isSpam = moderationService.isLikelySpam(body);
    if (isSpam) return res.status(400).json({ ok: false, error: 'Content flagged as spam' });

    const { rows } = await query(
      'INSERT INTO forum_answers (post_id, body, author_id, verified) VALUES ($1,$2,$3,$4) RETURNING *',
      [postId, body, author_id, verified || false],
    );
    res.json({ ok: true, answer: rows[0] });
  } catch (err) {
    console.error('forum:add answer', err);
    res.status(500).json({ ok: false, error: 'Failed to add answer' });
  }
});

// Vote on an answer
router.post('/answers/:id/vote', async (req: Request, res: Response) => {
  const answerId = req.params.id;
  const { user_id, delta } = req.body; // delta = 1 or -1

  try {
    if (![1, -1].includes(delta)) {
      return res.status(400).json({ ok: false, error: 'Invalid vote delta' });
    }

    await query('BEGIN');
    await query(
      'INSERT INTO forum_votes (answer_id, user_id, delta) VALUES ($1,$2,$3) ON CONFLICT (answer_id,user_id) DO UPDATE SET delta = EXCLUDED.delta',
      [answerId, user_id, delta],
    );
    await query(
      'UPDATE forum_answers SET votes = (SELECT COALESCE(SUM(delta),0) FROM forum_votes WHERE answer_id = $1) WHERE id = $1',
      [answerId],
    );
    await query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await query('ROLLBACK');
    console.error('forum:vote error', err);
    res.status(500).json({ ok: false, error: 'Failed to vote' });
  }
});

export default router;
