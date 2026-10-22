/**
 * Pure string formatting utilities for PetChain Mobile App.
 *
 * All functions are side-effect-free and work in any JavaScript environment
 * (React Native, Node.js, Web Workers).
 *
 * No external dependencies.
 */

// ─── capitalise ───────────────────────────────────────────────────────────────

/**
 * Uppercase the first character of a string; leave the rest unchanged.
 *
 * Returns an empty string for falsy input.
 *
 * @example
 * capitalise('hello world')  // "Hello world"
 * capitalise('HELLO')        // "HELLO"
 * capitalise('')             // ""
 */
export function capitalise(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── toTitleCase ──────────────────────────────────────────────────────────────

/**
 * Capitalise the first letter of every word in the string.
 *
 * Words are separated by one or more whitespace characters.
 *
 * @example
 * toTitleCase('the quick brown fox')  // "The Quick Brown Fox"
 * toTitleCase('hello world')          // "Hello World"
 */
export function toTitleCase(str: string): string {
  if (!str) return '';
  return str.replace(/\S+/g, (word) => capitalise(word.toLowerCase()));
}

// ─── truncate ─────────────────────────────────────────────────────────────────

/**
 * Shorten `str` to at most `maxLen` characters.
 * When truncation occurs the string is trimmed and an ellipsis (`…`) is appended.
 *
 * @param str     - Input string.
 * @param maxLen  - Maximum total length including the ellipsis character.
 * @param ellipsis - Override the default `…` suffix.
 *
 * @example
 * truncate('Hello, world!', 8)          // "Hello, …"
 * truncate('Short', 10)                 // "Short"
 * truncate('Hello, world!', 8, '...')   // "Hello..."
 */
export function truncate(str: string, maxLen: number, ellipsis = '…'): string {
  if (!str) return '';
  if (maxLen <= 0) return '';
  if (str.length <= maxLen) return str;
  const cutoff = maxLen - ellipsis.length;
  if (cutoff <= 0) return ellipsis.slice(0, maxLen);
  return str.slice(0, cutoff) + ellipsis;
}

// ─── maskEmail ────────────────────────────────────────────────────────────────

/**
 * Partially redact an email address for privacy display.
 *
 * The local part is masked except for the first character and the domain is kept.
 *
 * @example
 * maskEmail('alice@example.com')    // "a****@example.com"
 * maskEmail('ab@example.com')       // "a*@example.com"
 * maskEmail('a@example.com')        // "a@example.com"
 * maskEmail('not-an-email')         // "not-an-email"  (returned unchanged)
 */
export function maskEmail(email: string): string {
  if (!email) return '';
  const atIndex = email.indexOf('@');
  if (atIndex < 1) return email; // not a recognisable email address

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex); // includes the '@'

  if (local.length <= 1) return email; // nothing to mask

  const masked = local.charAt(0) + '*'.repeat(local.length - 1);
  return masked + domain;
}

// ─── maskPhone ────────────────────────────────────────────────────────────────

/**
 * Partially redact a phone number for privacy display.
 *
 * Only the last 4 digits are shown; all other digit positions are replaced with `*`.
 * Non-digit characters (spaces, dashes, parentheses) are removed from the output.
 *
 * @example
 * maskPhone('+1 (555) 123-4567')  // "********4567"
 * maskPhone('07700900123')        // "*******0123"
 * maskPhone('1234')               // "1234"          (≤ 4 digits, shown as-is)
 */
export function maskPhone(phone: string): string {
  if (!phone) return '';
  // Strip all non-digit characters
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  return '*'.repeat(digits.length - 4) + digits.slice(-4);
}

// ─── slugify ──────────────────────────────────────────────────────────────────

/**
 * Convert a string to a URL-safe slug.
 *
 * - Lowercases the string
 * - Normalises accented characters (é → e, ñ → n, etc.) via Unicode decomposition
 * - Replaces spaces and non-alphanumeric characters with hyphens
 * - Collapses consecutive hyphens into a single one
 * - Trims leading/trailing hyphens
 *
 * @example
 * slugify('Hello World!')          // "hello-world"
 * slugify('Café au lait')          // "cafe-au-lait"
 * slugify('  multiple   spaces ')  // "multiple-spaces"
 * slugify('PetChain -- App')       // "petchain-app"
 */
export function slugify(str: string): string {
  if (!str) return '';
  return (
    str
      .toLowerCase()
      // Decompose accented characters and strip the combining marks
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Replace any non-alphanumeric character (including spaces) with a hyphen
      .replace(/[^a-z0-9]+/g, '-')
      // Collapse repeated hyphens
      .replace(/-{2,}/g, '-')
      // Remove leading/trailing hyphens
      .replace(/^-+|-+$/g, '')
  );
}

// ─── stripHtml ────────────────────────────────────────────────────────────────

/**
 * Remove all HTML/XML tags from a string.
 *
 * Useful for sanitising rich-text content before displaying it in plain-text contexts.
 *
 * @example
 * stripHtml('<p>Hello <strong>world</strong>!</p>')  // "Hello world!"
 * stripHtml('No tags here')                          // "No tags here"
 */
export function stripHtml(str: string): string {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '');
}

// ─── initials ─────────────────────────────────────────────────────────────────

/**
 * Extract the initials from a full name string (up to `maxInitials` characters).
 *
 * Each word's first character is uppercased and concatenated.
 *
 * @example
 * initials('John Doe')           // "JD"
 * initials('Alice')              // "A"
 * initials('Mary Jane Watson', 2) // "MJ"
 */
export function initials(name: string, maxInitials = 2): string {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, maxInitials)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

// ─── padStart / padEnd convenience wrappers ───────────────────────────────────

/**
 * Left-pad `str` with `char` until it reaches `length`.
 *
 * @example
 * padStart('5', 2, '0')  // "05"
 */
export function padStart(str: string, length: number, char = ' '): string {
  return str.padStart(length, char);
}

/**
 * Right-pad `str` with `char` until it reaches `length`.
 *
 * @example
 * padEnd('hi', 5, '.')  // "hi..."
 */
export function padEnd(str: string, length: number, char = ' '): string {
  return str.padEnd(length, char);
}

// ─── toCamelCase ─────────────────────────────────────────────────────────────

/**
 * Convert a hyphen- or underscore-separated string to camelCase.
 *
 * @example
 * toCamelCase('hello-world')   // "helloWorld"
 * toCamelCase('foo_bar_baz')   // "fooBarBaz"
 */
export function toCamelCase(str: string): string {
  if (!str) return '';
  return str.toLowerCase().replace(/[-_](.)/g, (_, char: string) => char.toUpperCase());
}
