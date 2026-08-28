/**
 * Runtime configuration schema validation.
 *
 * Validates environment names, URLs, timeouts, sample rates, and other numeric
 * values before they are used at app startup. Fails safely per build profile.
 */

import type { Environment } from './index';

export interface ValidationResult {
  isValid: boolean;
  error: string | null;
  warnings: string[];
}

function valid(warnings: string[] = []): ValidationResult {
  return { isValid: true, error: null, warnings };
}

function invalid(error: string): ValidationResult {
  return { isValid: false, error, warnings: [] };
}

// ─── Validators ───────────────────────────────────────────────────────────────

function isValidEnvironment(value: unknown): ValidationResult {
  const env = String(value).trim().toLowerCase();
  if (!['development', 'staging', 'production'].includes(env)) {
    return invalid(
      `Invalid environment: "${value}". Must be one of: development, staging, production.`,
    );
  }
  return valid();
}

function isValidUrl(url: unknown, env: string): ValidationResult {
  const urlStr = String(url).trim();
  if (!urlStr) {
    return invalid('API URL is required.');
  }

  try {
    const parsed = new URL(urlStr);

    // Production must use HTTPS, never HTTP or localhost
    if (env === 'production') {
      if (parsed.protocol !== 'https:') {
        return invalid('Production API URL must use HTTPS (e.g. https://api.petchain.app/api).');
      }
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return invalid('Production builds cannot point to localhost. Use a real HTTPS endpoint.');
      }
    }

    // Staging should prefer HTTPS but warn if not
    if (env === 'staging' && parsed.protocol !== 'https:') {
      return valid(['Staging API URL should use HTTPS for security.']);
    }

    return valid();
  } catch {
    return invalid(`Invalid URL format: "${urlStr}". Must be a valid absolute URL.`);
  }
}

function isValidTimeout(value: unknown, env: string): ValidationResult {
  const num = Number(value);
  if (!isFinite(num) || isNaN(num)) {
    return invalid(`API timeout must be a valid number, got: ${value}`);
  }
  if (num < 100) {
    return invalid(`API timeout must be at least 100ms (got ${num}ms).`);
  }
  if (num > 120_000) {
    return invalid(`API timeout must be at most 120s (got ${num}ms).`);
  }
  return valid();
}

function isValidSampleRate(value: unknown): ValidationResult {
  const num = Number(value);
  if (!isFinite(num) || isNaN(num)) {
    return invalid(`Sample rate must be a valid number, got: ${value}`);
  }
  if (num < 0 || num > 1) {
    return invalid(`Sample rate must be between 0.0 and 1.0 (got ${num}).`);
  }
  return valid();
}

function isValidNumericConfig(value: unknown, name: string, min: number, max: number): ValidationResult {
  const num = Number(value);
  if (!isFinite(num) || isNaN(num)) {
    return invalid(`${name} must be a valid number, got: ${value}`);
  }
  if (num < min || num > max) {
    return invalid(`${name} must be between ${min} and ${max} (got ${num}).`);
  }
  return valid();
}

// ─── Public schema validator ──────────────────────────────────────────────────

export interface RuntimeConfig {
  env: Environment;
  apiBaseUrl: string;
  apiTimeoutMs: number;
  cacheSizeMb: number;
  paginationLimit: number;
  monitoringSampleRate: number;
  sessionTimeoutMs: number;
  crashFreeThreshold: number;
}

export function validateRuntimeConfig(config: Record<string, unknown>, env: Environment): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate env
  const envResult = isValidEnvironment(env);
  if (!envResult.isValid) {
    errors.push(envResult.error!);
  }

  // Validate API URL
  const urlResult = isValidUrl(config.apiBaseUrl, env);
  if (!urlResult.isValid) {
    errors.push(urlResult.error!);
  } else {
    warnings.push(...urlResult.warnings);
  }

  // Validate API timeout
  const timeoutResult = isValidTimeout(config.apiTimeoutMs, env);
  if (!timeoutResult.isValid) {
    errors.push(timeoutResult.error!);
  }

  // Validate cache size
  const cacheResult = isValidNumericConfig(config.cacheSizeMb, 'Cache size', 1, 500);
  if (!cacheResult.isValid) {
    errors.push(cacheResult.error!);
  }

  // Validate pagination limit
  const paginationResult = isValidNumericConfig(config.paginationLimit, 'Pagination limit', 1, 1000);
  if (!paginationResult.isValid) {
    errors.push(paginationResult.error!);
  }

  // Validate sample rate (for monitoring)
  const sampleRateResult = isValidSampleRate(config.monitoringSampleRate);
  if (!sampleRateResult.isValid) {
    errors.push(sampleRateResult.error!);
  }

  // Validate session timeout
  const sessionTimeoutResult = isValidNumericConfig(
    config.sessionTimeoutMs,
    'Session timeout',
    1000,
    86_400_000, // up to 24 hours
  );
  if (!sessionTimeoutResult.isValid) {
    errors.push(sessionTimeoutResult.error!);
  }

  // Validate crash-free threshold
  const crashFreeResult = isValidNumericConfig(config.crashFreeThreshold, 'Crash-free threshold', 0, 100);
  if (!crashFreeResult.isValid) {
    errors.push(crashFreeResult.error!);
  }

  if (errors.length > 0) {
    return { isValid: false, error: errors.join('\n'), warnings };
  }

  return { isValid: true, error: null, warnings };
}

// ─── Fail-safe behavior per profile ───────────────────────────────────────────

export function shouldFailHardOnConfigError(env: Environment): boolean {
  // Production must fail hard — no silent fallbacks
  return env === 'production';
}

export function logConfigWarnings(warnings: string[]): void {
  if (warnings.length === 0) return;
  console.warn('[Config] Runtime configuration warnings:', warnings);
}
