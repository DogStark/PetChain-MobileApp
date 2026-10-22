import { type ValidationResult } from '../models/AnrReport';

/**
 * ANR report validation utilities.
 */
export class AnrReportValidator {
  private static valid(): ValidationResult {
    return { isValid: true, error: null };
  }

  private static invalid(error: string): ValidationResult {
    return { isValid: false, error };
  }

  /**
   * Validate ANR report payload.
   */
  static validatePayload(payload: unknown): ValidationResult {
    if (!payload || typeof payload !== 'object') {
      return this.invalid('Payload must be a valid object.');
    }

    const p = payload as Record<string, unknown>;
    const { platform, type, timestamp, threadName, stackTrace } = p;

    if (!['android', 'ios'].includes(platform as string)) {
      return this.invalid("Platform must be 'android' or 'ios'.");
    }

    if (!['anr', 'hang'].includes(type as string)) {
      return this.invalid("Type must be 'anr' or 'hang'.");
    }

    if (!timestamp || typeof timestamp !== 'string') {
      return this.invalid('Timestamp is required and must be a string.');
    }

    // Basic ISO 8601 validation
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/.test(timestamp)) {
      return this.invalid('Timestamp must be in ISO 8601 format.');
    }

    if (!threadName || typeof threadName !== 'string' || threadName.length === 0) {
      return this.invalid('Thread name is required and must be a non-empty string.');
    }

    if (!stackTrace || typeof stackTrace !== 'string' || stackTrace.length === 0) {
      return this.invalid('Stack trace is required and must be a non-empty string.');
    }

    // Optional fields validation
    if (p.appVersion && typeof p.appVersion !== 'string') {
      return this.invalid('App version must be a string if provided.');
    }

    if (p.osVersion && typeof p.osVersion !== 'string') {
      return this.invalid('OS version must be a string if provided.');
    }

    if (p.deviceModel && typeof p.deviceModel !== 'string') {
      return this.invalid('Device model must be a string if provided.');
    }

    if (p.additionalInfo && typeof p.additionalInfo !== 'object') {
      return this.invalid('Additional info must be an object if provided.');
    }

    return this.valid();
  }

  /**
   * Validate report filters.
   */
  static validateFilters(filters: unknown): ValidationResult {
    if (!filters || typeof filters !== 'object') {
      return this.valid(); // Empty filters are valid
    }

    const f = filters as Record<string, unknown>;

    const allowedKeys = [
      'platform',
      'type',
      'appVersion',
      'osVersion',
      'processed',
      'dateFrom',
      'dateTo',
      'limit',
      'offset',
    ];

    for (const key of Object.keys(f)) {
      if (!allowedKeys.includes(key)) {
        return this.invalid(`Unknown filter key: ${key}`);
      }
    }

    if (f.platform && !['android', 'ios'].includes(f.platform as string)) {
      return this.invalid("Platform filter must be 'android' or 'ios'.");
    }

    if (f.type && !['anr', 'hang'].includes(f.type as string)) {
      return this.invalid("Type filter must be 'anr' or 'hang'.");
    }

    if (
      f.limit &&
      (!Number.isInteger(f.limit) || (f.limit as number) < 1 || (f.limit as number) > 1000)
    ) {
      return this.invalid('Limit must be an integer between 1 and 1000.');
    }

    if (f.offset && (!Number.isInteger(f.offset) || (f.offset as number) < 0)) {
      return this.invalid('Offset must be a non-negative integer.');
    }

    return this.valid();
  }
}
