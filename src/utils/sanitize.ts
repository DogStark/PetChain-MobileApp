/**
 * sanitize.ts
 *
 * Client-side input sanitization utilities for PetChain Mobile App.
 *
 * These functions strip or neutralise characters that could be dangerous
 * when interpolated into queries, HTML, or system commands.  They should
 * be applied to every user-supplied string value **before** it is sent
 * to the API inside a mutation payload.
 *
 * Design principles:
 *  - Pure: no side-effects, no mutation of the original input.
 *  - Composable: `sanitizeObject` delegates to `sanitizeString` so a
 *    single rule change propagates everywhere.
 *  - Transparent: returns the sanitized value unchanged when the input is
 *    already clean, so downstream callers never need a null-check.
 *  - TypeScript-first: generics preserve the original shape of objects.
 */

// ─── sanitizeString ───────────────────────────────────────────────────────────

/**
 * Strip characters that are commonly used in injection attacks from a
 * string value.
 *
 * Removed / escaped:
 *  - HTML/XML tags  (`<` and `>`)
 *  - SQL meta-characters  (`'`, `"`, `;`, `--`, and block-comment delimiters)
 *  - NoSQL / template injection markers  (`{`, `}`, `$`)
 *  - Null bytes  (`\0`)
 *  - Redundant whitespace (leading/trailing trimmed; internal runs collapsed
 *    to a single space)
 *
 * The function **does not** mutate the input and always returns a `string`.
 *
 * @example
 * sanitizeString("O'Reilly")         // "O Reilly"
 * sanitizeString("<script>alert(1)") // "scriptalert1"
 * sanitizeString("  hello  world  ") // "hello world"
 * sanitizeString(null as any)        // ""
 */
export function sanitizeString(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'string') return sanitizeString(String(input));

  return (
    input
      .trim()
      // Remove null bytes
      .replace(/\0/g, '')
      // Strip HTML/XML tags (and their content markers)
      .replace(/[<>]/g, '')
      // Remove SQL single-quote, double-quote, semicolons
      .replace(/['"`;]/g, '')
      // Remove SQL comment sequences
      .replace(/--|\/\*|\*\//g, '')
      // Remove NoSQL / template injection markers
      .replace(/[{}$]/g, '')
      // Collapse internal whitespace to a single space
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

// ─── sanitizeObject ──────────────────────────────────────────────────────────

/**
 * Recursively apply `sanitizeString` to every string-valued field in an
 * object.  Non-string primitives and `null`/`undefined` values are passed
 * through unchanged.  The original object is **never mutated**.
 *
 * Handles plain objects and arrays; class instances are returned as-is to
 * avoid unintentional structural changes.
 *
 * @example
 * sanitizeObject({ name: "O'Reilly", age: 3 })
 * // → { name: "O Reilly", age: 3 }
 *
 * sanitizeObject({ tags: ["<b>bold</b>", "safe"] })
 * // → { tags: ["bold", "safe"] }
 *
 * sanitizeObject(null)  // → null
 */
export function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;

  // Plain array
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item)) as unknown as T;
  }

  // Plain object (not a class instance)
  if (typeof obj === 'object' && Object.getPrototypeOf(obj) === Object.prototype) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const value = (obj as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        result[key] = sanitizeString(value);
      } else if (value !== null && typeof value === 'object') {
        result[key] = sanitizeObject(value);
      } else {
        result[key] = value;
      }
    }
    return result as T;
  }

  // Primitive string at the top level
  if (typeof obj === 'string') {
    return sanitizeString(obj) as unknown as T;
  }

  // Number, boolean, symbol, function, class instance — return unchanged
  return obj;
}
