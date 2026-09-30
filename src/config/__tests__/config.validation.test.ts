import {
  validateRuntimeConfig,
  shouldFailHardOnConfigError,
  logConfigWarnings,
} from '../schema';

describe('Runtime Config Validation (Issue #900)', () => {
  describe('validateRuntimeConfig', () => {
    const validConfig = {
      apiBaseUrl: 'https://api.petchain.app/api',
      apiTimeoutMs: 10000,
      cacheSizeMb: 50,
      paginationLimit: 20,
      monitoringSampleRate: 1.0,
      sessionTimeoutMs: 30 * 60 * 1000,
      crashFreeThreshold: 99.5,
    };

    it('passes validation for valid production config', () => {
      const result = validateRuntimeConfig(validConfig, 'production');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    it('passes validation for valid development config with localhost', () => {
      const devConfig = { ...validConfig, apiBaseUrl: 'http://localhost:3000/api' };
      const result = validateRuntimeConfig(devConfig, 'development');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    describe('unsafe-cast behavior (Issue #900)', () => {
      it('catches undefined API URL', () => {
        const config = { ...validConfig, apiBaseUrl: undefined };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('API URL');
      });

      it('catches empty API URL', () => {
        const config = { ...validConfig, apiBaseUrl: '' };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('API URL');
      });

      it('catches NaN timeout (from Number(undefined))', () => {
        const config = { ...validConfig, apiTimeoutMs: NaN };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('timeout');
      });

      it('catches invalid numeric timeout string', () => {
        const config = { ...validConfig, apiTimeoutMs: 'invalid' };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('timeout');
      });

      it('catches sample rate > 1.0', () => {
        const config = { ...validConfig, monitoringSampleRate: 1.5 };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Sample rate');
      });

      it('catches negative sample rate', () => {
        const config = { ...validConfig, monitoringSampleRate: -0.5 };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Sample rate');
      });

      it('catches NaN sample rate', () => {
        const config = { ...validConfig, monitoringSampleRate: NaN };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
      });
    });

    describe('URL validation', () => {
      it('rejects invalid URL format', () => {
        const config = { ...validConfig, apiBaseUrl: 'not-a-url' };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('URL format');
      });

      it('rejects HTTP URL for production', () => {
        const config = { ...validConfig, apiBaseUrl: 'http://api.petchain.app/api' };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('HTTPS');
      });

      it('rejects localhost for production', () => {
        const config = { ...validConfig, apiBaseUrl: 'https://localhost:8080/api' };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('localhost');
      });

      it('rejects 127.0.0.1 for production', () => {
        const config = { ...validConfig, apiBaseUrl: 'https://127.0.0.1:8080/api' };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('localhost');
      });

      it('allows HTTP for development', () => {
        const config = { ...validConfig, apiBaseUrl: 'http://localhost:3000/api' };
        const result = validateRuntimeConfig(config, 'development');
        expect(result.isValid).toBe(true);
      });

      it('warns on HTTP for staging (but passes)', () => {
        const config = { ...validConfig, apiBaseUrl: 'http://staging.petchain.app/api' };
        const result = validateRuntimeConfig(config, 'staging');
        expect(result.isValid).toBe(true);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0]).toContain('HTTPS');
      });
    });

    describe('timeout validation', () => {
      it('rejects timeout < 100ms', () => {
        const config = { ...validConfig, apiTimeoutMs: 50 };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('100ms');
      });

      it('rejects timeout > 120s', () => {
        const config = { ...validConfig, apiTimeoutMs: 150_000 };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('120');
      });

      it('accepts timeout at boundaries', () => {
        const min = validateRuntimeConfig(
          { ...validConfig, apiTimeoutMs: 100 },
          'production',
        );
        expect(min.isValid).toBe(true);

        const max = validateRuntimeConfig(
          { ...validConfig, apiTimeoutMs: 120_000 },
          'production',
        );
        expect(max.isValid).toBe(true);
      });
    });

    describe('numeric config validation', () => {
      it('rejects invalid cache size', () => {
        const config = { ...validConfig, cacheSizeMb: 'not-a-number' };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Cache size');
      });

      it('rejects cache size < 1', () => {
        const config = { ...validConfig, cacheSizeMb: 0 };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
      });

      it('rejects pagination limit < 1', () => {
        const config = { ...validConfig, paginationLimit: 0 };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
      });

      it('rejects session timeout < 1s', () => {
        const config = { ...validConfig, sessionTimeoutMs: 500 };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Session timeout');
      });

      it('rejects crash-free threshold > 100', () => {
        const config = { ...validConfig, crashFreeThreshold: 101 };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Crash-free');
      });
    });

    describe('multiple validation errors', () => {
      it('collects all errors', () => {
        const config = {
          apiBaseUrl: undefined,
          apiTimeoutMs: NaN,
          cacheSizeMb: -10,
          paginationLimit: undefined,
          monitoringSampleRate: 2.0,
          sessionTimeoutMs: 0,
          crashFreeThreshold: 150,
        };
        const result = validateRuntimeConfig(config, 'production');
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('URL');
        expect(result.error).toContain('timeout');
        expect(result.error).toContain('Cache');
        expect(result.error).toContain('Sample rate');
        expect(result.error).toContain('Crash-free');
      });
    });
  });

  describe('shouldFailHardOnConfigError', () => {
    it('returns true for production', () => {
      expect(shouldFailHardOnConfigError('production')).toBe(true);
    });

    it('returns false for development', () => {
      expect(shouldFailHardOnConfigError('development')).toBe(false);
    });

    it('returns false for staging', () => {
      expect(shouldFailHardOnConfigError('staging')).toBe(false);
    });
  });

  describe('logConfigWarnings', () => {
    it('logs warnings to console.warn', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      logConfigWarnings(['Warning 1', 'Warning 2']);
      expect(warnSpy).toHaveBeenCalledWith('[Config] Runtime configuration warnings:', [
        'Warning 1',
        'Warning 2',
      ]);
      warnSpy.mockRestore();
    });

    it('does not log when no warnings', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      logConfigWarnings([]);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
