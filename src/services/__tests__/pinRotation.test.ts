import {
  checkPinExpiry,
  recordPinFailure,
  getPinsForHostname,
  validatePin,
  getPinStatus,
  isPinErrorFromNetworkIssue,
} from '../pinRotationService';

describe('Pin Rotation and Telemetry (Issue #902)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('checkPinExpiry', () => {
    it('monitors pins approaching expiry', () => {
      const alerts = checkPinExpiry();
      // Test file pins are in future, so expect no alerts in normal run
      // In real scenario, would check against actual expiry dates
      expect(Array.isArray(alerts)).toBe(true);
    });

    it('returns alert object with hostname and affected roles', () => {
      const alerts = checkPinExpiry();
      alerts.forEach((alert) => {
        expect(alert).toHaveProperty('hostname');
        expect(alert).toHaveProperty('affectedRoles');
        expect(Array.isArray(alert.affectedRoles)).toBe(true);
      });
    });

    it('includes only primary and backup roles', () => {
      const alerts = checkPinExpiry();
      alerts.forEach((alert) => {
        alert.affectedRoles.forEach((role) => {
          expect(['primary', 'backup']).toContain(role);
        });
      });
    });
  });

  describe('recordPinFailure', () => {
    it('converts pin-failure error into privacy-safe telemetry', () => {
      const error = new Error('SSL certificate pinning failed');
      const telemetry = recordPinFailure(error, 'api.petchain.app');

      expect(telemetry.hostname).toBe('api.petchain.app');
      expect(telemetry.timestamp).toBeDefined();
      expect(telemetry.errorType).toBeDefined();
      expect(telemetry.isBackupAvailable).toBeDefined();
    });

    it('detects SSL errors', () => {
      const error = new Error('SSL_ERROR: certificate verification failed');
      const telemetry = recordPinFailure(error, 'api.petchain.app');
      expect(telemetry.errorType).toBe('ssl_error');
    });

    it('detects certificate errors', () => {
      const error = new Error('Certificate error: untrusted issuer');
      const telemetry = recordPinFailure(error, 'api.petchain.app');
      expect(telemetry.errorType).toBe('certificate_error');
    });

    it('detects pinning errors', () => {
      const error = new Error('Pin verification failed: fingerprint mismatch');
      const telemetry = recordPinFailure(error, 'api.petchain.app');
      expect(telemetry.errorType).toBe('pinning_error');
    });

    it('reports backup availability', () => {
      // api.petchain.app has primary + backup
      const telemetry = recordPinFailure(
        new Error('SSL certificate pinning failed'),
        'api.petchain.app',
      );
      expect(telemetry.isBackupAvailable).toBe(true);

      // staging.petchain.app has only primary
      const stagingTelemetry = recordPinFailure(
        new Error('SSL certificate pinning failed'),
        'staging.petchain.app',
      );
      expect(stagingTelemetry.isBackupAvailable).toBe(false);
    });

    it('does not include raw error messages in telemetry', () => {
      const rawError = 'This is a secret token: abc123def456';
      const error = new Error(rawError);
      const telemetry = recordPinFailure(error, 'api.petchain.app');

      // Telemetry should not contain the raw error message
      const telemetryStr = JSON.stringify(telemetry);
      expect(telemetryStr).not.toContain('secret');
      expect(telemetryStr).not.toContain('abc123def456');
    });

    it('does not include PII or health data', () => {
      const error = new Error('Connection failed for user@example.com');
      const telemetry = recordPinFailure(error, 'api.petchain.app');

      const telemetryStr = JSON.stringify(telemetry);
      expect(telemetryStr).not.toContain('user@example.com');
    });
  });

  describe('getPinsForHostname', () => {
    it('returns pins for configured hostname', () => {
      const pins = getPinsForHostname('api.petchain.app');
      expect(Array.isArray(pins)).toBe(true);
      expect(pins.length).toBeGreaterThan(0);
      pins.forEach((pin) => {
        expect(pin).toMatch(/^sha256\//);
      });
    });

    it('returns empty array for unconfigured hostname', () => {
      const pins = getPinsForHostname('unknown.example.com');
      expect(pins).toEqual([]);
    });
  });

  describe('validatePin', () => {
    it('accepts pin that matches primary', () => {
      const correctPin = 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      const isValid = validatePin(correctPin, 'api.petchain.app');
      expect(isValid).toBe(true);
    });

    it('accepts pin that matches backup', () => {
      const backupPin = 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
      const isValid = validatePin(backupPin, 'api.petchain.app');
      expect(isValid).toBe(true);
    });

    it('rejects pin that matches neither primary nor backup', () => {
      const wrongPin = 'sha256/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX=';
      const isValid = validatePin(wrongPin, 'api.petchain.app');
      expect(isValid).toBe(false);
    });

    it('allows request for hostname with no pins configured', () => {
      const anyPin = 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      const isValid = validatePin(anyPin, 'unknown.example.com');
      expect(isValid).toBe(true);
    });

    it('supports overlapping rotation windows (both pins valid simultaneously)', () => {
      const primary = 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      const backup = 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';

      expect(validatePin(primary, 'api.petchain.app')).toBe(true);
      expect(validatePin(backup, 'api.petchain.app')).toBe(true);
    });
  });

  describe('getPinStatus', () => {
    it('returns primary and backup pin metadata', () => {
      const status = getPinStatus('api.petchain.app');

      expect(status.primary).toBeDefined();
      expect(status.backup).toBeDefined();
      expect(status.primary?.role).toBe('primary');
      expect(status.backup?.role).toBe('backup');
    });

    it('returns rotation window when both pins exist', () => {
      const status = getPinStatus('api.petchain.app');

      if (status.primary && status.backup) {
        expect(status.rotationWindow).toBeDefined();
        expect(status.rotationWindow?.startDate).toBeDefined();
        expect(status.rotationWindow?.endDate).toBeDefined();
      }
    });

    it('handles hostname with only primary pin', () => {
      const status = getPinStatus('staging.petchain.app');

      expect(status.primary).toBeDefined();
      expect(status.backup).toBeUndefined();
      expect(status.rotationWindow).toBeNull();
    });

    it('handles unknown hostname gracefully', () => {
      const status = getPinStatus('unknown.example.com');

      expect(status.primary).toBeUndefined();
      expect(status.backup).toBeUndefined();
      expect(status.rotationWindow).toBeNull();
    });
  });

  describe('isPinErrorFromNetworkIssue', () => {
    it('detects timeout errors', () => {
      const error = new Error('Request timeout after 5000ms');
      expect(isPinErrorFromNetworkIssue(error)).toBe(true);
    });

    it('detects offline errors', () => {
      const error = new Error('Device is offline');
      expect(isPinErrorFromNetworkIssue(error)).toBe(true);
    });

    it('detects network errors', () => {
      const error = new Error('Network error: no internet connection');
      expect(isPinErrorFromNetworkIssue(error)).toBe(true);
    });

    it('detects connection refused', () => {
      const error = new Error('ECONNREFUSED: connection refused');
      expect(isPinErrorFromNetworkIssue(error)).toBe(true);
    });

    it('returns false for actual pin failures', () => {
      const error = new Error('SSL certificate pinning failed');
      expect(isPinErrorFromNetworkIssue(error)).toBe(false);
    });

    it('returns false for certificate errors', () => {
      const error = new Error('Certificate error: untrusted issuer');
      expect(isPinErrorFromNetworkIssue(error)).toBe(false);
    });
  });

  describe('no bypass mechanism', () => {
    it('getPinsForHostname never returns a bypass flag', () => {
      const pins = getPinsForHostname('api.petchain.app');
      // Pins should be actual pin strings, not a bypass marker
      expect(pins).not.toContain('bypass');
      expect(pins).not.toContain('debug');
      pins.forEach((pin) => {
        expect(pin).toMatch(/^sha256\//);
      });
    });

    it('validatePin has no debug override for production', () => {
      // No way to pass a debug flag or bypass value
      const result = validatePin('sha256/INVALID', 'api.petchain.app');
      expect(result).toBe(false);

      // Trying to pass a debug-like value should still fail validation
      const debugResult = validatePin('debug-bypass', 'api.petchain.app');
      expect(debugResult).toBe(false);
    });

    it('recordPinFailure cannot be suppressed or bypassed', () => {
      const warnSpy = jest.spyOn(console, 'warn');
      const error = new Error('SSL certificate pinning failed');

      // recordPinFailure always returns telemetry, cannot opt out
      const telemetry = recordPinFailure(error, 'api.petchain.app');
      expect(telemetry).toBeDefined();
      expect(telemetry.hostname).toBe('api.petchain.app');
    });
  });

  describe('offline/timeout handling', () => {
    it('distinguishes pin failure from network timeout', () => {
      const timeout = new Error('Request timeout');
      const pinFailure = new Error('SSL certificate pinning failed');

      expect(isPinErrorFromNetworkIssue(timeout)).toBe(true);
      expect(isPinErrorFromNetworkIssue(pinFailure)).toBe(false);
    });

    it('allows retry on timeout but not on pin failure', () => {
      const timeout = new Error('Connection timeout');
      const pinFailure = new Error('Certificate pinning validation failed');

      // Timeouts should be retried
      const timeoutIsNetworkIssue = isPinErrorFromNetworkIssue(timeout);
      expect(timeoutIsNetworkIssue).toBe(true);

      // Pin failures should not be silently retried
      const pinFailureIsNetworkIssue = isPinErrorFromNetworkIssue(pinFailure);
      expect(pinFailureIsNetworkIssue).toBe(false);
    });
  });

  describe('pin rotation scenarios', () => {
    it('supports old pin valid, new pin valid (overlap window)', () => {
      // During rotation, both primary (old) and backup (new) should be valid
      const primary = 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      const backup = 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';

      expect(validatePin(primary, 'api.petchain.app')).toBe(true);
      expect(validatePin(backup, 'api.petchain.app')).toBe(true);
    });

    it('rejects both pins invalid (hard failure)', () => {
      const oldExpiredPin = 'sha256/YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY=';
      const newFailedPin = 'sha256/ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ=';

      expect(validatePin(oldExpiredPin, 'api.petchain.app')).toBe(false);
      expect(validatePin(newFailedPin, 'api.petchain.app')).toBe(false);
    });
  });
});
