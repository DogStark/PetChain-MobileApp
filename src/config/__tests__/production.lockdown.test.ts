import { validateRuntimeConfig, shouldFailHardOnConfigError } from '../schema';

describe('Production Lockdown (Issue #901)', () => {
  const validProdConfig = {
    apiBaseUrl: 'https://api.petchain.app/api',
    apiTimeoutMs: 10000,
    cacheSizeMb: 50,
    paginationLimit: 20,
    monitoringSampleRate: 0.5,
    sessionTimeoutMs: 30 * 60 * 1000,
    crashFreeThreshold: 99.5,
  };

  describe('production builds reject localhost fallback', () => {
    it('rejects localhost HTTP fallback in production', () => {
      // This reproduces the unsafe behavior: fallback to localhost when no URL env is set
      const config = { ...validProdConfig, apiBaseUrl: 'http://localhost:3000/api' };
      const result = validateRuntimeConfig(config, 'production');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('localhost');
    });

    it('rejects HTTP API in production even with real domain', () => {
      const config = { ...validProdConfig, apiBaseUrl: 'http://api.petchain.app/api' };
      const result = validateRuntimeConfig(config, 'production');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('HTTPS');
    });

    it('requires explicit HTTPS production URLs', () => {
      const config = { ...validProdConfig, apiBaseUrl: 'https://api.petchain.app/api' };
      const result = validateRuntimeConfig(config, 'production');
      expect(result.isValid).toBe(true);
    });

    it('fails hard on production validation errors', () => {
      expect(shouldFailHardOnConfigError('production')).toBe(true);
    });
  });

  describe('per-profile validation', () => {
    it('allows localhost only in development', () => {
      const devConfig = { ...validProdConfig, apiBaseUrl: 'http://localhost:3000/api' };
      const result = validateRuntimeConfig(devConfig, 'development');
      expect(result.isValid).toBe(true);
    });

    it('allows localhost in staging for testing', () => {
      const stagingConfig = { ...validProdConfig, apiBaseUrl: 'http://localhost:3000/api' };
      const result = validateRuntimeConfig(stagingConfig, 'staging');
      expect(result.isValid).toBe(true);
    });

    it('development validation is lenient on HTTP', () => {
      expect(shouldFailHardOnConfigError('development')).toBe(false);
    });

    it('staging validation is lenient on HTTP', () => {
      expect(shouldFailHardOnConfigError('staging')).toBe(false);
    });
  });

  describe('missing/malformed URLs per profile', () => {
    it('catches empty URL in production', () => {
      const config = { ...validProdConfig, apiBaseUrl: '' };
      const result = validateRuntimeConfig(config, 'production');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('API URL');
    });

    it('catches undefined URL in production', () => {
      const config = { ...validProdConfig, apiBaseUrl: undefined };
      const result = validateRuntimeConfig(config, 'production');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('API URL');
    });

    it('catches malformed URL in production', () => {
      const config = { ...validProdConfig, apiBaseUrl: 'not a url' };
      const result = validateRuntimeConfig(config, 'production');
      expect(result.isValid).toBe(false);
    });

    it('development gracefully handles empty URL (warn but continue)', () => {
      expect(shouldFailHardOnConfigError('development')).toBe(false);
    });
  });

  describe('EAS profile integration', () => {
    it('simulates production EAS build with valid config', () => {
      // EAS production profile sets APP_ENV=production
      const result = validateRuntimeConfig(validProdConfig, 'production');
      expect(result.isValid).toBe(true);
    });

    it('simulates staging EAS build', () => {
      const stagingConfig = { ...validProdConfig, apiBaseUrl: 'https://staging.petchain.app/api' };
      const result = validateRuntimeConfig(stagingConfig, 'staging');
      expect(result.isValid).toBe(true);
    });

    it('simulates development EAS build with localhost', () => {
      const devConfig = { ...validProdConfig, apiBaseUrl: 'http://localhost:3000/api' };
      const result = validateRuntimeConfig(devConfig, 'development');
      expect(result.isValid).toBe(true);
    });
  });

  describe('no silent fallbacks', () => {
    it('production never falls back to localhost when URL is missing', () => {
      // Simulate missing env var — would be undefined
      const config = { ...validProdConfig, apiBaseUrl: undefined };
      const result = validateRuntimeConfig(config, 'production');
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
      // In production, this would throw hard and prevent app startup
      expect(shouldFailHardOnConfigError('production')).toBe(true);
    });

    it('production requires explicit API_BASE_URL or PROD_API_URL', () => {
      // Without explicit prod URL, validation fails
      const config = { ...validProdConfig, apiBaseUrl: '' };
      const result = validateRuntimeConfig(config, 'production');
      expect(result.isValid).toBe(false);
    });
  });
});
