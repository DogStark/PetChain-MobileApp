/**
 * Forum Content Moderation Service
 *
 * Server-side keyword filter with:
 *  - Configurable blocklist stored in the DB (not hardcoded)
 *  - Admin-managed whitelist to prevent false positives (e.g. medical terms)
 *  - "Suggest edit" mode: returns flagged words so the frontend can prompt the
 *    user to revise before outright blocking
 *  - Blocked posts return a structured error payload (422 CONTENT_FLAGGED)
 *
 * DB Schema (run as a migration):
 *
 *   CREATE TABLE moderation_keywords (
 *     id       SERIAL PRIMARY KEY,
 *     word     TEXT NOT NULL UNIQUE,
 *     type     TEXT NOT NULL CHECK (type IN ('block', 'whitelist')),
 *     added_by TEXT,
 *     added_at TIMESTAMPTZ DEFAULT now()
 *   );
 *
 * The keyword list is cached in memory and refreshed every CACHE_TTL_MS.
 */

import { query } from '../src/db/index';

// ─── Types ────────────────────────────────────────────────────────────────────

export type KeywordType = 'block' | 'whitelist';

export interface ModerationKeyword {
  id: number;
  word: string;
  type: KeywordType;
  addedBy?: string;
  addedAt: string;
}

export interface ModerationResult {
  /** true when the content should be allowed */
  allowed: boolean;
  /** Words found in the content that triggered the filter */
  flaggedWords: string[];
  /** true when the post should be suggested for edit rather than hard-blocked */
  suggestEdit: boolean;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

/** How long (ms) to cache the keyword lists from the DB */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _blocklistCache: string[] = [];
let _whitelistCache: string[] = [];
let _cacheExpiry = 0;

async function loadKeywords(): Promise<void> {
  if (Date.now() < _cacheExpiry) return;

  try {
    const result = await query(
      `SELECT word, type FROM moderation_keywords`,
      [],
    );

    const keywords: Array<{ word: string; type: KeywordType }> = result.rows as any;
    _blocklistCache = keywords
      .filter((k) => k.type === 'block')
      .map((k) => k.word.toLowerCase());
    _whitelistCache = keywords
      .filter((k) => k.type === 'whitelist')
      .map((k) => k.word.toLowerCase());

    _cacheExpiry = Date.now() + CACHE_TTL_MS;
  } catch {
    // If DB is unavailable fall back to empty lists (open moderation)
    _blocklistCache = [];
    _whitelistCache = [];
    _cacheExpiry = Date.now() + 30_000; // retry in 30 s
  }
}

/** Force-refresh the in-memory keyword cache (call after admin updates). */
export function invalidateModerationCache(): void {
  _cacheExpiry = 0;
}

// ─── Core moderation logic ────────────────────────────────────────────────────

/**
 * Check content for blocked words.
 * Whitelisted words take precedence over blocklisted words
 * (e.g. "castration" may be blocklisted but whitelisted as a medical term).
 *
 * @param content  The text to check (title + body)
 * @param suggestEditThreshold  If the number of flagged words is at or below
 *        this threshold the result uses suggestEdit=true instead of hard-block.
 */
export async function checkContent(
  content: string,
  suggestEditThreshold = 2,
): Promise<ModerationResult> {
  await loadKeywords();

  const normalised = content.toLowerCase();

  // Tokenise — match whole words only to reduce false positives
  const flaggedWords = _blocklistCache.filter((blocked) => {
    if (_whitelistCache.includes(blocked)) return false; // whitelisted
    // Match as whole word
    const regex = new RegExp(`\\b${escapeRegex(blocked)}\\b`);
    return regex.test(normalised);
  });

  if (flaggedWords.length === 0) {
    return { allowed: true, flaggedWords: [], suggestEdit: false };
  }

  const suggestEdit = flaggedWords.length <= suggestEditThreshold;
  return { allowed: false, flaggedWords, suggestEdit };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Admin keyword management ─────────────────────────────────────────────────

export async function addKeyword(
  word: string,
  type: KeywordType,
  addedBy?: string,
): Promise<ModerationKeyword> {
  const result = await query(
    `
    INSERT INTO moderation_keywords (word, type, added_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (word) DO UPDATE SET type = EXCLUDED.type, added_by = EXCLUDED.added_by
    RETURNING id, word, type, added_by AS "addedBy", added_at AS "addedAt"
    `,
    [word.toLowerCase().trim(), type, addedBy ?? null],
  );
  invalidateModerationCache();
  return result.rows[0] as ModerationKeyword;
}

export async function removeKeyword(word: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM moderation_keywords WHERE word = $1`,
    [word.toLowerCase().trim()],
  );
  invalidateModerationCache();
  return (result.rowCount ?? 0) > 0;
}

export async function listKeywords(type?: KeywordType): Promise<ModerationKeyword[]> {
  const result = await query(
    type
      ? `SELECT id, word, type, added_by AS "addedBy", added_at AS "addedAt"
         FROM moderation_keywords WHERE type = $1 ORDER BY word`
      : `SELECT id, word, type, added_by AS "addedBy", added_at AS "addedAt"
         FROM moderation_keywords ORDER BY type, word`,
    type ? [type] : [],
  );
  return result.rows as ModerationKeyword[];
}
