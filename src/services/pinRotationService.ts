/**
 * Certificate pin rotation and expiry monitoring.
 *
 * Supports primary + backup pin sets so rotation can happen without hard cutover.
 * Monitors expiry dates and sends privacy-safe telemetry on pin failures.
 */

import { logError } from '../utils/errorLogger';
import {
  SSL_PINS,
  SSL_PIN_STRINGS,
  PIN_EXPIRY_WARNING_DAYS,
  PIN_FAILURE_SUPPORT_URL,
  type PinSet,
} from '../config/security';

// ─── Expiry monitoring ─────────────────────────────────────────────────────────

interface PinExpiryAlert {
  hostname: string;
  daysUntilExpiry: number;
  affectedRoles: string[]; // 'primary', 'backup'
}

const expiryCheckIntervalMs = 24 * 60 * 60 * 1000; // daily
let lastExpiryCheckTime = 0;

export function checkPinExpiry(): PinExpiryAlert[] {
  const now = Date.now();
  if (now - lastExpiryCheckTime < expiryCheckIntervalMs) {
    return []; // Already checked recently
  }
  lastExpiryCheckTime = now;

  const alerts: PinExpiryAlert[] = [];
  const today = new Date();

  for (const [hostname, pinSets] of Object.entries(SSL_PINS)) {
    const affectedRoles: string[] = [];

    for (const pinSet of pinSets) {
      if (!pinSet.expiryDate) continue;

      const expiryDate = new Date(pinSet.expiryDate);
      const daysUntilExpiry = Math.ceil(
        (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysUntilExpiry <= PIN_EXPIRY_WARNING_DAYS && daysUntilExpiry > 0) {
        affectedRoles.push(pinSet.role);
      }
    }

    if (affectedRoles.length > 0) {
      alerts.push({ hostname, daysUntilExpiry: Math.max(0, Math.min(...[])), affectedRoles });

      // Log warning (not error) for visibility
      console.warn('[Pin Rotation] Certificate expiry warning', {
        hostname,
        affectedRoles,
        daysUntilExpiry: Math.ceil(
          (new Date(SSL_PINS[hostname][0].expiryDate || '').getTime() - today.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      });
    }
  }

  return alerts;
}

// ─── Privacy-safe pin failure telemetry ────────────────────────────────────────

export interface PinFailureTelemetry {
  hostname: string;
  timestamp: string;
  errorType: 'ssl_error' | 'certificate_error' | 'pinning_error' | 'unknown';
  isBackupAvailable: boolean;
  // NO raw error messages, no tokens, no PII, no health data
}

/**
 * Convert a pin-failure error into privacy-safe telemetry.
 * Only logs non-sensitive diagnostic data: hostname, error category, availability of backup pins.
 */
export function recordPinFailure(
  error: Error,
  hostname: string,
): PinFailureTelemetry {
  const errorMessage = error.message.toLowerCase();
  let errorType: PinFailureTelemetry['errorType'] = 'unknown';

  if (errorMessage.includes('ssl') || errorMessage.includes('tls')) {
    errorType = 'ssl_error';
  } else if (errorMessage.includes('certificate') || errorMessage.includes('cert')) {
    errorType = 'certificate_error';
  } else if (errorMessage.includes('pin') || errorMessage.includes('fingerprint')) {
    errorType = 'pinning_error';
  }

  const pinSets = SSL_PINS[hostname] || [];
  const isBackupAvailable = pinSets.some((p) => p.role === 'backup');

  const telemetry: PinFailureTelemetry = {
    hostname,
    timestamp: new Date().toISOString(),
    errorType,
    isBackupAvailable,
  };

  // Log diagnostic data (no raw error message, no tokens)
  logError(new Error('[Pin Failure Diagnostics]'), {
    service: 'pinRotation',
    action: 'pin_failure',
    ...telemetry,
  });

  return telemetry;
}

// ─── No bypass mechanism ──────────────────────────────────────────────────────

/**
 * Always check if a domain requires pinning.
 * Returns the pins that must match, or empty array if no pins for this domain.
 * There is no bypass flag or debug override.
 */
export function getPinsForHostname(hostname: string): string[] {
  const pins = SSL_PIN_STRINGS[hostname] || [];
  return pins;
}

/**
 * Verify that at least one pin in the pin set matches the server's certificate.
 * Both primary and backup pins are valid — allows overlapping rotation windows.
 *
 * Returns true only if a pin matches. Returns false otherwise (hard failure).
 */
export function validatePin(serverPin: string, hostname: string): boolean {
  const requiredPins = getPinsForHostname(hostname);
  if (requiredPins.length === 0) {
    // No pins required for this hostname — allow
    return true;
  }
  // Must match at least one of the required pins
  return requiredPins.includes(serverPin);
}

// ─── Rotation support ──────────────────────────────────────────────────────────

/**
 * Get the status of pins for a hostname (useful for monitoring/debugging).
 * Returns metadata about primary and backup pins.
 */
export function getPinStatus(hostname: string): {
  primary: PinSet | undefined;
  backup: PinSet | undefined;
  rotationWindow: { startDate: string; endDate: string } | null;
} {
  const pinSets = SSL_PINS[hostname] || [];
  const primary = pinSets.find((p) => p.role === 'primary');
  const backup = pinSets.find((p) => p.role === 'backup');

  let rotationWindow: { startDate: string; endDate: string } | null = null;
  if (primary?.expiryDate && backup?.expiryDate) {
    rotationWindow = {
      startDate: primary.expiryDate, // Start of overlap
      endDate: backup.expiryDate, // End of rotation window
    };
  }

  return { primary, backup, rotationWindow };
}

// ─── Offline/timeout handling ──────────────────────────────────────────────────

/**
 * Check if a pin validation error is due to network issues (offline/timeout)
 * vs actual pin failure (MITM/expired cert).
 */
export function isPinErrorFromNetworkIssue(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('offline') ||
    msg.includes('network') ||
    msg.includes('connection refused') ||
    msg.includes('econnrefused')
  );
}
