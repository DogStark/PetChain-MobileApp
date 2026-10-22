/* eslint-disable @typescript-eslint/no-non-null-assertion */
import express from 'express';
import { v4 as uuid } from 'uuid';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { ok, sendError } from '../response';
import { store } from '../store';

// ─── In-memory store (future: replace with DB) ────────────────────────────────

interface CommunityPost {
  id: string;
  authorId: string;
  authorName: string;
  category: 'forum' | 'tip' | 'app';
  title: string;
  body: string;
  petId?: string;
  petName?: string;
  likes: number;
  createdAt: string;
  updatedAt: string;
}

const posts = new Map<string, CommunityPost>();

// ─── Router ───────────────────────────────────────────────────────────────────

const router = express.Router();
router.use(authenticateJWT);

// GET /community/posts
router.get('/posts', (_req: AuthenticatedRequest, res) => {
  const sorted = Array.from(posts.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return res.json(ok(sorted));
});

// POST /community/posts
router.post('/posts', (req: AuthenticatedRequest, res) => {
  const { category, title, body, petId, petName } = req.body as Partial<CommunityPost>;

  if (!category || !title || !body) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'category, title and body are required');
  }
  if (!['forum', 'tip', 'app'].includes(category)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'category must be forum, tip, or app');
  }

  const now = new Date().toISOString();
  const post: CommunityPost = {
    id: uuid(),
    authorId: req.user!.id,
    authorName: store.users.get(req.user!.id)?.name ?? req.user!.email,
    category,
    title: title.trim(),
    body: body.trim(),
    petId,
    petName,
    likes: 0,
    createdAt: now,
    updatedAt: now,
  };
  posts.set(post.id, post);
  return res.json(ok(post));
});

// POST /community/posts/:id/like
router.post('/posts/:id/like', (req: AuthenticatedRequest, res) => {
  const post = posts.get(req.params.id);
  if (!post) return sendError(res, 404, 'NOT_FOUND', 'Post not found');
  post.likes += 1;
  post.updatedAt = new Date().toISOString();
  posts.set(post.id, post);
  return res.json(ok(post));
});

// DELETE /community/posts/:id
router.delete('/posts/:id', (req: AuthenticatedRequest, res) => {
  const post = posts.get(req.params.id);
  if (!post) return sendError(res, 404, 'NOT_FOUND', 'Post not found');
  if (post.authorId !== req.user!.id) {
    return sendError(res, 403, 'FORBIDDEN', 'You can only delete your own posts');
  }
  posts.delete(req.params.id);
  return res.json(ok({ deleted: true }));
});

export default router;
