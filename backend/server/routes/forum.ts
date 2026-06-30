/**
 * Forum routes  — /api/forum
 *
 * POST /api/forum/posts
 *   Runs moderation check before persisting.
 *   - If content is HARD-BLOCKED → 422 { code: 'CONTENT_FLAGGED', suggestEdit: false }
 *   - If content is SUGGEST-EDIT  → 422 { code: 'CONTENT_FLAGGED', suggestEdit: true, flaggedWords }
 *   - Otherwise → 201 with the created post
 *
 * GET  /api/forum/posts             — list posts (optional ?search, ?top)
 * GET  /api/forum/posts/:id         — single post + answers
 * POST /api/forum/posts/:id/answers — post an answer (also moderated)
 * POST /api/forum/answers/:id/vote  — upvote / downvote answer
 *
 * Admin (no auth guard added here; add your own middleware in production):
 * GET    /api/forum/moderation/keywords         — list keywords
 * POST   /api/forum/moderation/keywords         — add keyword
 * DELETE /api/forum/moderation/keywords/:word   — remove keyword
 */

import { Router, type Request, type Response } from 'express';

import {
  checkContent,
  addKeyword,
  removeKeyword,
  listKeywords,
  type KeywordType,
} from '../../services/moderationService';

const router = Router();

// ─── In-memory store (replace with DB in production) ─────────────────────────

interface ForumPost {
  id: number;
  title: string;
  body: string;
  species?: string;
  breed?: string;
  author_id?: string;
  created_at: string;
}

interface ForumAnswer {
  id: number;
  post_id: number;
  body: string;
  author_id?: string;
  verified: boolean;
  votes: number;
  created_at: string;
}

let _postIdSeq = 1;
let _answerIdSeq = 1;
const _posts = new Map<number, ForumPost>();
const _answers = new Map<number, ForumAnswer[]>();

// ─── Helper ───────────────────────────────────────────────────────────────────

function topPosts(search?: string): ForumPost[] {
  const all = [..._posts.values()];
  if (!search?.trim()) return all.sort((a, b) => b.id - a.id);
  const q = search.toLowerCase();
  return all
    .filter((p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q))
    .sort((a, b) => b.id - a.id);
}

// ─── POST /api/forum/posts ────────────────────────────────────────────────────

router.post('/posts', async (req: Request, res: Response) => {
  const { title, body, species, breed, author_id } = req.body as {
    title?: string;
    body?: string;
    species?: string;
    breed?: string;
    author_id?: string;
  };

  if (!title?.trim() || !body?.trim()) {
    return res.status(400).json({ success: false, message: 'title and body are required' });
  }

  // ── Moderation check ──────────────────────────────────────────────────────
  const moderation = await checkContent(`${title} ${body}`);

  if (!moderation.allowed) {
    return res.status(422).json({
      success: false,
      code: 'CONTENT_FLAGGED',
      suggestEdit: moderation.suggestEdit,
      flaggedWords: moderation.flaggedWords,
      message: moderation.suggestEdit
        ? 'Your post contains flagged language. Please edit and resubmit.'
        : 'Your post was blocked due to prohibited content.',
    });
  }
  // ─────────────────────────────────────────────────────────────────────────

  const post: ForumPost = {
    id: _postIdSeq++,
    title: title.trim(),
    body: body.trim(),
    species: species?.trim() || undefined,
    breed: breed?.trim() || undefined,
    author_id: author_id ?? 'anonymous',
    created_at: new Date().toISOString(),
  };

  _posts.set(post.id, post);
  _answers.set(post.id, []);

  return res.status(201).json({ success: true, post });
});

// ─── GET /api/forum/posts ─────────────────────────────────────────────────────

router.get('/posts', (req: Request, res: Response) => {
  const { search } = req.query as { search?: string };
  return res.json({ success: true, posts: topPosts(search) });
});

// ─── GET /api/forum/posts/:id ─────────────────────────────────────────────────

router.get('/posts/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const post = _posts.get(id);
  if (!post) {
    return res.status(404).json({ success: false, message: 'Post not found' });
  }
  return res.json({ success: true, post, answers: _answers.get(id) ?? [] });
});

// ─── POST /api/forum/posts/:id/answers ───────────────────────────────────────

router.post('/posts/:id/answers', async (req: Request, res: Response) => {
  const postId = Number(req.params.id);
  if (!_posts.has(postId)) {
    return res.status(404).json({ success: false, message: 'Post not found' });
  }

  const { body, author_id, verified } = req.body as {
    body?: string;
    author_id?: string;
    verified?: boolean;
  };

  if (!body?.trim()) {
    return res.status(400).json({ success: false, message: 'body is required' });
  }

  // ── Moderation check ──────────────────────────────────────────────────────
  const moderation = await checkContent(body);
  if (!moderation.allowed) {
    return res.status(422).json({
      success: false,
      code: 'CONTENT_FLAGGED',
      suggestEdit: moderation.suggestEdit,
      flaggedWords: moderation.flaggedWords,
      message: moderation.suggestEdit
        ? 'Your answer contains flagged language. Please edit and resubmit.'
        : 'Your answer was blocked due to prohibited content.',
    });
  }
  // ─────────────────────────────────────────────────────────────────────────

  const answer: ForumAnswer = {
    id: _answerIdSeq++,
    post_id: postId,
    body: body.trim(),
    author_id: author_id ?? 'anonymous',
    verified: Boolean(verified),
    votes: 0,
    created_at: new Date().toISOString(),
  };

  const list = _answers.get(postId) ?? [];
  list.unshift(answer);
  _answers.set(postId, list);

  return res.status(201).json({ success: true, answer });
});

// ─── POST /api/forum/answers/:id/vote ────────────────────────────────────────

router.post('/answers/:id/vote', (req: Request, res: Response) => {
  const answerId = Number(req.params.id);
  const { delta } = req.body as { delta?: 1 | -1 };

  if (delta !== 1 && delta !== -1) {
    return res.status(400).json({ success: false, message: 'delta must be 1 or -1' });
  }

  for (const [postId, list] of _answers) {
    const answer = list.find((a) => a.id === answerId);
    if (answer) {
      answer.votes += delta;
      _answers.set(postId, list);
      return res.json({ success: true, answer });
    }
  }

  return res.status(404).json({ success: false, message: 'Answer not found' });
});

// ─── Admin: keyword management ────────────────────────────────────────────────

router.get('/moderation/keywords', async (_req: Request, res: Response) => {
  const keywords = await listKeywords();
  return res.json({ success: true, keywords });
});

router.post('/moderation/keywords', async (req: Request, res: Response) => {
  const { word, type, addedBy } = req.body as { word?: string; type?: KeywordType; addedBy?: string };
  if (!word?.trim() || !type || !['block', 'whitelist'].includes(type)) {
    return res.status(400).json({ success: false, message: 'word and type (block|whitelist) are required' });
  }
  const keyword = await addKeyword(word.trim(), type, addedBy);
  return res.status(201).json({ success: true, keyword });
});

router.delete('/moderation/keywords/:word', async (req: Request, res: Response) => {
  const removed = await removeKeyword(decodeURIComponent(req.params.word));
  if (!removed) {
    return res.status(404).json({ success: false, message: 'Keyword not found' });
  }
  return res.json({ success: true, removed: true });
});

export default router;
