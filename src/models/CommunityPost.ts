// ─── Community Post Model ─────────────────────────────────────────────────────

export type PostCategory = 'forum' | 'tip' | 'app';

export interface CommunityPost {
  id: string;
  authorId: string;
  authorName: string;
  category: PostCategory;
  title: string;
  body: string;
  petId?: string;
  petName?: string;
  likes: number;
  likedByMe: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePostInput {
  authorId: string;
  authorName: string;
  category: PostCategory;
  title: string;
  body: string;
  petId?: string;
  petName?: string;
}
