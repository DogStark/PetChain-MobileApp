/**
 * Input validation utilities for PetChain Mobile App.
 *
 * All validators are pure functions that return a `ValidationResult`:
 *   { isValid: true,  error: null }   — passes validation
 *   { isValid: false, error: string } — fails with a human-readable message
 *
 * This mirrors the backend/utils/validators.ts pattern so validation logic
 * can be shared or compared across the stack.
 */

// ─── ValidationResult ─────────────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  error: string | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function valid(): ValidationResult {
  return { isValid: true, error: null };
}

function invalid(error: string): ValidationResult {
  return { isValid: false, error };
}

function normalize(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// ─── Regexes ──────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// E.164-like: optional leading +, 7–15 digits
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

// ─── isValidEmail ─────────────────────────────────────────────────────────────

/**
 * Validate an email address format.
 *
 * @example
 * isValidEmail('user@example.com')  // { isValid: true, error: null }
 * isValidEmail('not-an-email')      // { isValid: false, error: '…' }
 */
export function isValidEmail(email: unknown): ValidationResult {
  const value = normalize(email);
  if (!value) return invalid('Email is required.');
  if (value.length > 254) return invalid('Email must be 254 characters or fewer.');
  if (!EMAIL_REGEX.test(value)) return invalid('Please enter a valid email address.');
  return valid();
}

// ─── isValidPhone ─────────────────────────────────────────────────────────────

/**
 * Validate a phone number in E.164-like format.
 * Spaces, dashes, dots, and parentheses are stripped before testing.
 *
 * @example
 * isValidPhone('+12345678')   // { isValid: true, error: null }
 * isValidPhone('123')         // { isValid: false, error: '…' }
 */
export function isValidPhone(phone: unknown): ValidationResult {
  const raw = normalize(phone);
  if (!raw) return invalid('Phone number is required.');
  const stripped = raw.replace(/[\s\-().]/g, '');
  if (!PHONE_REGEX.test(stripped)) {
    return invalid('Please enter a valid phone number (7–15 digits, optional leading +).');
  }
  return valid();
}

// ─── isValidDate ─────────────────────────────────────────────────────────────

/**
 * Validate that the value is a parseable, real calendar date.
 * ISO 8601 `YYYY-MM-DD` strings are cross-checked for calendar correctness
 * (e.g. `2024-02-30` is rejected even though `new Date()` would accept it).
 *
 * @example
 * isValidDate('2025-06-15')   // { isValid: true, error: null }
 * isValidDate('2024-02-30')   // { isValid: false, error: '…' }
 */
export function isValidDate(date: unknown): ValidationResult {
  const value = normalize(date);
  if (!value) return invalid('Date is required.');

  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return invalid('Please enter a valid date.');

  // Extra calendar-reality check for YYYY-MM-DD strings
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch.map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    if (utc.getUTCFullYear() !== y || utc.getUTCMonth() + 1 !== m || utc.getUTCDate() !== d) {
      return invalid('Please enter a real calendar date.');
    }
  }

  return valid();
}

// ─── validatePetAge ───────────────────────────────────────────────────────────

/**
 * Validate a pet's age in years.
 *
 * Rules:
 * - Must be a finite number
 * - Must be ≥ 0 (newborns allowed)
 * - Must be ≤ 50 (upper practical limit for any known pet species)
 *
 * @example
 * validatePetAge(3)    // { isValid: true, error: null }
 * validatePetAge(-1)   // { isValid: false, error: '…' }
 * validatePetAge(200)  // { isValid: false, error: '…' }
 */
export function validatePetAge(age: unknown): ValidationResult {
  if (age === null || age === undefined || age === '') {
    return invalid('Pet age is required.');
  }
  const num = Number(age);
  if (!isFinite(num) || isNaN(num)) {
    return invalid('Pet age must be a number.');
  }
  if (num < 0) {
    return invalid('Pet age cannot be negative.');
  }
  if (num > 50) {
    return invalid('Pet age must be 50 years or less.');
  }
  return valid();
}

// ─── validateDosage ───────────────────────────────────────────────────────────

/**
 * Validate a medication dosage value.
 *
 * Accepts a number (or numeric string) with an optional unit suffix
 * (e.g. `"5mg"`, `"2.5 ml"`, `"100 mcg"`).
 *
 * Rules:
 * - Must be present
 * - Numeric part must be > 0
 * - Numeric part must be ≤ 10 000 (safety upper-bound)
 *
 * @example
 * validateDosage('5mg')     // { isValid: true, error: null }
 * validateDosage(2.5)       // { isValid: true, error: null }
 * validateDosage('-1mg')    // { isValid: false, error: '…' }
 * validateDosage('0')       // { isValid: false, error: '…' }
 */
export function validateDosage(dosage: unknown): ValidationResult {
  const raw = normalize(dosage);
  if (!raw) return invalid('Dosage is required.');

  // Extract leading numeric portion (integer or decimal)
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*/);
  if (!match) {
    return invalid('Dosage must start with a positive number (e.g. "5mg", "2.5 ml").');
  }

  const num = parseFloat(match[1]);
  if (num <= 0) {
    return invalid('Dosage must be greater than zero.');
  }
  if (num > 10_000) {
    return invalid('Dosage must be 10 000 or less.');
  }

  return valid();
}

// ─── Legacy boolean helpers (backwards compat with existing callers) ──────────

/**
 * @deprecated Prefer `isValidEmail(email).isValid`.
 * Kept for backwards compatibility with existing callers that expect a boolean.
 */
export function isValidEmailBool(email: unknown): boolean {
  return isValidEmail(email).isValid;
}

/**
 * @deprecated Prefer `isValidPhone(phone).isValid`.
 */
export function isValidPhoneBool(phone: unknown): boolean {
  return isValidPhone(phone).isValid;
}

/**
 * @deprecated Prefer `isValidDate(date).isValid`.
 */
export function isValidDateBool(date: unknown): boolean {
  return isValidDate(date).isValid;
}

// ─── Error message constants (for form-level display) ─────────────────────────

export const VALIDATION_ERRORS = {
  email: 'Please enter a valid email address.',
  phone: 'Please enter a valid phone number (7–15 digits, optional leading +).',
  date: 'Please enter a valid date.',
  petAge: 'Pet age must be between 0 and 50.',
  dosage: 'Dosage must be a positive number (e.g. "5mg", "2.5 ml").',
} as const;
