/**
 * Unit tests for src/utils/sanitize.ts
 *
 * Verifies that:
 *  - sanitizeString strips dangerous characters without mutating the input
 *  - sanitizeObject recursively applies sanitization to all string fields
 *  - Neither function mutates its input
 */

import { sanitizeString, sanitizeObject } from '../sanitize';

// ─── sanitizeString ───────────────────────────────────────────────────────────

describe('sanitizeString()', () => {
  // ── Null / undefined / non-string inputs ──────────────────────────────────

  it('returns "" for null input', () => {
    expect(sanitizeString(null as unknown as string)).toBe('');
  });

  it('returns "" for undefined input', () => {
    expect(sanitizeString(undefined as unknown as string)).toBe('');
  });

  it('coerces numbers to sanitized strings', () => {
    expect(sanitizeString(42 as unknown as string)).toBe('42');
  });

  it('returns "" for an empty string', () => {
    expect(sanitizeString('')).toBe('');
  });

  // ── HTML / XML injection ───────────────────────────────────────────────────

  it('strips < and > (HTML tags)', () => {
    expect(sanitizeString('<script>alert(1)</script>')).toBe('scriptalert1script');
  });

  it('strips angle brackets from a partial tag', () => {
    expect(sanitizeString('<b>bold</b>')).toBe('bbodb');
  });

  // ── SQL injection ─────────────────────────────────────────────────────────

  it("strips single quotes", () => {
    expect(sanitizeString("O'Reilly")).toBe('OReilly');
  });

  it('strips double quotes', () => {
    expect(sanitizeString('"quoted"')).toBe('quoted');
  });

  it('strips semicolons', () => {
    expect(sanitizeString('DROP TABLE pets;')).toBe('DROP TABLE pets');
  });

  it('strips backtick characters', () => {
    expect(sanitizeString('`column`')).toBe('column');
  });

  it('strips SQL single-line comment sequences (--)', () => {
    expect(sanitizeString('1 -- comment')).toBe('1  comment');
  });

  it('strips SQL block comment sequences (/* */)', () => {
    expect(sanitizeString('1 /* comment */')).toBe('1  comment ');
  });

  // ── NoSQL / template injection ────────────────────────────────────────────

  it('strips curly braces', () => {
    expect(sanitizeString('{ "$ne": null }')).toBe(' ne: null ');
  });

  it('strips dollar signs', () => {
    expect(sanitizeString('$where: 1')).toBe('where: 1');
  });

  // ── Null bytes ────────────────────────────────────────────────────────────

  it('removes null bytes', () => {
    expect(sanitizeString('hello\0world')).toBe('helloworld');
  });

  // ── Whitespace normalisation ──────────────────────────────────────────────

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('collapses internal runs of whitespace to a single space', () => {
    expect(sanitizeString('hello   world')).toBe('hello world');
  });

  it('handles mixed leading/trailing/internal whitespace', () => {
    expect(sanitizeString('  foo   bar  ')).toBe('foo bar');
  });

  // ── Clean inputs pass through unchanged ───────────────────────────────────

  it('returns a clean string unchanged', () => {
    expect(sanitizeString('Buddy the Labrador')).toBe('Buddy the Labrador');
  });

  it('preserves hyphens in names', () => {
    expect(sanitizeString('Mary-Jane')).toBe('Mary-Jane');
  });

  it('preserves numbers', () => {
    expect(sanitizeString('Tablet 5mg')).toBe('Tablet 5mg');
  });

  it('preserves @ in email addresses (no SQL chars)', () => {
    expect(sanitizeString('user@example.com')).toBe('user@example.com');
  });
});

// ─── sanitizeObject ───────────────────────────────────────────────────────────

describe('sanitizeObject()', () => {
  // ── Null / undefined passthrough ─────────────────────────────────────────

  it('returns null for null input', () => {
    expect(sanitizeObject(null)).toBeNull();
  });

  it('returns undefined for undefined input', () => {
    expect(sanitizeObject(undefined)).toBeUndefined();
  });

  // ── Plain object ──────────────────────────────────────────────────────────

  it('sanitizes all string fields in a plain object', () => {
    const input = { name: "O'Reilly", age: 3 };
    const result = sanitizeObject(input);
    expect(result).toEqual({ name: 'OReilly', age: 3 });
  });

  it('leaves non-string fields untouched', () => {
    const input = { count: 42, active: true, ratio: 1.5, nothing: null };
    const result = sanitizeObject(input);
    expect(result).toEqual({ count: 42, active: true, ratio: 1.5, nothing: null });
  });

  it('sanitizes nested objects recursively', () => {
    const input = { owner: { name: "<admin>", email: 'safe@test.com' } };
    const result = sanitizeObject(input);
    expect(result).toEqual({ owner: { name: 'admin', email: 'safe@test.com' } });
  });

  // ── Arrays ────────────────────────────────────────────────────────────────

  it('sanitizes string elements in a top-level array', () => {
    const input = ['<b>bold</b>', 'safe'];
    const result = sanitizeObject(input);
    expect(result).toEqual(['bbold b', 'safe']);
  });

  it('sanitizes strings inside an array field on an object', () => {
    const input = { tags: ['<b>bold</b>', 'clean'] };
    const result = sanitizeObject(input);
    expect(result).toEqual({ tags: ['bbold b', 'clean'] });
  });

  // ── Immutability ──────────────────────────────────────────────────────────

  it('does NOT mutate the original object', () => {
    const input = { name: "<script>" };
    const before = input.name;
    sanitizeObject(input);
    expect(input.name).toBe(before);
  });

  it('does NOT mutate nested objects', () => {
    const inner = { label: "'unsafe'" };
    const input = { inner };
    sanitizeObject(input);
    expect(inner.label).toBe("'unsafe'");
  });

  // ── Primitives at top level ───────────────────────────────────────────────

  it('sanitizes a top-level string value', () => {
    expect(sanitizeObject("DROP TABLE;")).toBe('DROP TABLE');
  });

  it('passes through top-level numbers unchanged', () => {
    expect(sanitizeObject(42)).toBe(42);
  });

  it('passes through top-level booleans unchanged', () => {
    expect(sanitizeObject(true)).toBe(true);
  });

  // ── Class instances (passed through unchanged) ────────────────────────────

  it('returns class instances without modification', () => {
    class MyError extends Error {}
    const err = new MyError('test');
    expect(sanitizeObject(err)).toBe(err);
  });

  // ── Realistic mutation payload ────────────────────────────────────────────

  it('sanitizes a realistic CreatePetInput payload', () => {
    const input = {
      name: "Fido'; DROP TABLE pets;--",
      species: 'dog',
      breed: '<Golden Retriever>',
      weightKg: 30,
      ownerId: 'owner-123',
    };
    const result = sanitizeObject(input);
    expect(result).toEqual({
      name: 'Fido DROP TABLE pets',
      species: 'dog',
      breed: 'Golden Retriever',
      weightKg: 30,
      ownerId: 'owner-123',
    });
  });
});
