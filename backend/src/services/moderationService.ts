/**
 * Simple moderation heuristics for spam/harmful advice.
 * This is a lightweight service intended for server-side filtering.
 */
const HARMFUL_KEYWORDS = ['poison', 'suicide', 'harm', 'kill', 'illegal', 'toxic'];
const SPAM_PATTERNS = [/http[s]?:\/\//i, /buy now/i, /free gift/i, /click here/i];

export function isLikelySpam(text: string | null | undefined): boolean {
  if (!text) return false;
  const content = text.toLowerCase();
  for (const kw of HARMFUL_KEYWORDS) {
    if (content.includes(kw)) return true;
  }
  for (const rx of SPAM_PATTERNS) {
    if (rx.test(content)) return true;
  }
  // very short content
  if (content.trim().length < 10) return true;
  return false;
}

export default { isLikelySpam };
