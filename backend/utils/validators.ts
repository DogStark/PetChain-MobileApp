export interface ValidationResult {
  isValid: boolean;
  error: string | null;
}

export interface DateValidationOptions {
  allowPast?: boolean;
  allowFuture?: boolean;
  minDate?: Date | string;
  maxDate?: Date | string;
}

export interface PasswordValidationOptions {
  minLength?: number;
  maxLength?: number;
  requireUppercase?: boolean;
  requireLowercase?: boolean;
  requireNumber?: boolean;
  requireSpecial?: boolean;
}

export interface GenericFieldRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  patternMessage?: string;
  customValidator?: (value: string) => ValidationResult;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/; // E.164-like: 7 to 15 digits with optional leading +
const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const NUMBER_REGEX = /\d/;
const SPECIAL_REGEX = /[^A-Za-z0-9]/;

function valid(): ValidationResult {
  return { isValid: true, error: null };
}

function invalid(error: string): ValidationResult {
  return { isValid: false, error };
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRealCalendarDate(value: string): boolean {
  const dateOnlyRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = value.match(dateOnlyRegex);
  if (!match) return true;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}

/**
 * Validate email format.
 */
export function validateEmail(email: unknown): ValidationResult {
  const value = normalizeValue(email);
  if (!value) return invalid('Email is required.');
  if (value.length > 254) return invalid('Email must be 254 characters or fewer.');
  if (!EMAIL_REGEX.test(value)) return invalid('Please enter a valid email address.');
  return valid();
}

/**
 * Validate phone number format using E.164-like rules.
 * Accepts optional spaces, dashes, and parentheses in input.
 */
export function validatePhoneNumber(phone: unknown): ValidationResult {
  const raw = normalizeValue(phone);
  if (!raw) return invalid('Phone number is required.');

  const normalized = raw.replace(/[\s\-().]/g, '');
  if (!PHONE_REGEX.test(normalized)) {
    return invalid('Please enter a valid phone number (7 to 15 digits, optional leading +).');
  }

  return valid();
}

/**
 * Validate date value and optional date range constraints.
 */
export function validateDate(
  input: Date | string | unknown,
  options: DateValidationOptions = {},
): ValidationResult {
  const value = normalizeValue(input);
  if (!value) return invalid('Date is required.');

  if (!isRealCalendarDate(value)) {
    return invalid('Please enter a real calendar date.');
  }

  const date = parseDate(value);
  if (!date) return invalid('Please enter a valid date.');

  const minDate = options.minDate ? parseDate(options.minDate) : null;
  const maxDate = options.maxDate ? parseDate(options.maxDate) : null;

  if (options.minDate && !minDate) return invalid('Invalid minimum date constraint.');
  if (options.maxDate && !maxDate) return invalid('Invalid maximum date constraint.');

  if (minDate && date < minDate) {
    return invalid(`Date must be on or after ${minDate.toISOString().slice(0, 10)}.`);
  }

  if (maxDate && date > maxDate) {
    return invalid(`Date must be on or before ${maxDate.toISOString().slice(0, 10)}.`);
  }

  const now = new Date();
  if (options.allowPast === false && date < now) {
    return invalid('Date cannot be in the past.');
  }
  if (options.allowFuture === false && date > now) {
    return invalid('Date cannot be in the future.');
  }

  return valid();
}

/**
 * Validate password strength with configurable requirements.
 */
export function validatePasswordStrength(
  password: unknown,
  options: PasswordValidationOptions = {},
): ValidationResult {
  const value = normalizeValue(password);
  if (!value) return invalid('Password is required.');

  const {
    minLength = 8,
    maxLength = 128,
    requireUppercase = true,
    requireLowercase = true,
    requireNumber = true,
    requireSpecial = true,
  } = options;

  if (value.length < minLength)
    return invalid(`Password must be at least ${minLength} characters.`);
  if (value.length > maxLength)
    return invalid(`Password must be ${maxLength} characters or fewer.`);
  if (requireUppercase && !UPPERCASE_REGEX.test(value)) {
    return invalid('Password must include at least one uppercase letter.');
  }
  if (requireLowercase && !LOWERCASE_REGEX.test(value)) {
    return invalid('Password must include at least one lowercase letter.');
  }
  if (requireNumber && !NUMBER_REGEX.test(value)) {
    return invalid('Password must include at least one number.');
  }
  if (requireSpecial && !SPECIAL_REGEX.test(value)) {
    return invalid('Password must include at least one special character.');
  }

  return valid();
}

/**
 * Generic required field validator.
 */
export function validateRequired(value: unknown, fieldName = 'Field'): ValidationResult {
  const normalized = normalizeValue(value);
  if (!normalized) return invalid(`${fieldName} is required.`);
  return valid();
}

/**
 * Generic minimum length validator.
 */
export function validateMinLength(
  value: unknown,
  minLength: number,
  fieldName = 'Field',
): ValidationResult {
  const normalized = normalizeValue(value);
  if (normalized.length < minLength) {
    return invalid(`${fieldName} must be at least ${minLength} characters.`);
  }
  return valid();
}

/**
 * Generic maximum length validator.
 */
export function validateMaxLength(
  value: unknown,
  maxLength: number,
  fieldName = 'Field',
): ValidationResult {
  const normalized = normalizeValue(value);
  if (normalized.length > maxLength) {
    return invalid(`${fieldName} must be ${maxLength} characters or fewer.`);
  }
  return valid();
}

/**
 * Generic pattern validator.
 */
export function validatePattern(
  value: unknown,
  pattern: RegExp,
  fieldName = 'Field',
  message?: string,
): ValidationResult {
  const normalized = normalizeValue(value);
  if (!pattern.test(normalized)) {
    return invalid(message ?? `${fieldName} format is invalid.`);
  }
  return valid();
}

/**
 * Generic field validator using a declarative set of rules.
 */
export function validateField(
  value: unknown,
  rules: GenericFieldRule,
  fieldName = 'Field',
): ValidationResult {
  if (rules.required) {
    const requiredResult = validateRequired(value, fieldName);
    if (!requiredResult.isValid) return requiredResult;
  }

  const normalized = normalizeValue(value);
  if (!normalized && !rules.required) return valid();

  if (typeof rules.minLength === 'number') {
    const minLengthResult = validateMinLength(normalized, rules.minLength, fieldName);
    if (!minLengthResult.isValid) return minLengthResult;
  }

  if (typeof rules.maxLength === 'number') {
    const maxLengthResult = validateMaxLength(normalized, rules.maxLength, fieldName);
    if (!maxLengthResult.isValid) return maxLengthResult;
  }

  if (rules.pattern) {
    const patternResult = validatePattern(
      normalized,
      rules.pattern,
      fieldName,
      rules.patternMessage,
    );
    if (!patternResult.isValid) return patternResult;
  }

  if (rules.customValidator) {
    const customResult = rules.customValidator(normalized);
    if (!customResult.isValid) return customResult;
  }

  return valid();
}
