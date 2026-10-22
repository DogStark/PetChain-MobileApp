import { getItem, setItem } from './localDB';
import type { CommunityPost, CreatePostInput } from '../models/CommunityPost';

// ─── Constants ────────────────────────────────────────────────────────────────

const POSTS_CACHE_KEY = '@community_posts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadPosts(): Promise<CommunityPost[]> {
  const raw = await getItem(POSTS_CACHE_KEY);
  return raw ? (JSON.parse(raw) as CommunityPost[]) : [];
}

async function savePosts(posts: CommunityPost[]): Promise<void> {
  await setItem(POSTS_CACHE_KEY, JSON.stringify(posts));
}

function generateId(): string {
  return `post_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function getPosts(): Promise<CommunityPost[]> {
  const posts = await loadPosts();
  return posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function createPost(input: CreatePostInput): Promise<CommunityPost> {
  const posts = await loadPosts();
  const now = new Date().toISOString();
  const post: CommunityPost = {
    id: generateId(),
    ...input,
    likes: 0,
    likedByMe: false,
    createdAt: now,
    updatedAt: now,
  };
  posts.unshift(post);
  await savePosts(posts);
  return post;
}

export async function toggleLike(postId: string): Promise<CommunityPost | null> {
  const posts = await loadPosts();
  const idx = posts.findIndex((p) => p.id === postId);
  if (idx === -1) return null;
  const post = posts[idx];
  post.likedByMe = !post.likedByMe;
  post.likes = post.likedByMe ? post.likes + 1 : Math.max(0, post.likes - 1);
  post.updatedAt = new Date().toISOString();
  posts[idx] = post;
  await savePosts(posts);
  return post;
}

export async function deletePost(postId: string): Promise<void> {
  const posts = await loadPosts();
  await savePosts(posts.filter((p) => p.id !== postId));
}
