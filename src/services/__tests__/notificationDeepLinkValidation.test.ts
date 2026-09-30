import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractDeepLinkParams } from '../notificationService';

describe('notificationService - deep link payload validation', () => {
  describe('schema validation and safety', () => {
    it('should accept valid medication notification payload', () => {
      const payload = {
        type: 'medication',
        medicationId: 'med-uuid-valid-123',
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).not.toBeNull();
      expect(result?.route).toBe('Medications');
      expect(result?.params?.medicationId).toBe('med-uuid-valid-123');
    });

    it('should accept valid appointment notification payload', () => {
      const payload = {
        type: 'appointment',
        appointmentId: 'apt-uuid-valid-456',
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).not.toBeNull();
      expect(result?.route).toBe('Appointments');
      expect(result?.params?.appointmentId).toBe('apt-uuid-valid-456');
    });

    it('should accept valid vaccination payload with petId', () => {
      const payload = {
        type: 'vaccination',
        vaccinationId: 'vax-uuid-valid-789',
        petId: 'pet-uuid-valid-123',
        dueDate: '2026-09-15',
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).not.toBeNull();
      expect(result?.route).toBe('Vaccinations');
      expect(result?.params?.vaccinationId).toBe('vax-uuid-valid-789');
      expect(result?.params?.petId).toBe('pet-uuid-valid-123');
    });

    it('should accept valid SOS notification payload', () => {
      const payload = {
        type: 'sos',
        sosId: 'sos-uuid-valid-123',
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).not.toBeNull();
      expect(result?.route).toBe('Emergency');
      expect(result?.params?.sosId).toBe('sos-uuid-valid-123');
    });

    it('should accept valid PetDetail fallback payload', () => {
      const payload = {
        type: 'general',
        petId: 'pet-uuid-valid-456',
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).not.toBeNull();
      expect(result?.route).toBe('PetDetail');
      expect(result?.params?.petId).toBe('pet-uuid-valid-456');
    });

    it('should reject payload with unknown route type', () => {
      const payload = {
        type: 'malicious-route',
        someId: 'some-value',
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).toBeNull();
    });

    it('should reject medication payload without medicationId', () => {
      const payload = {
        type: 'medication',
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).toBeNull();
    });

    it('should reject appointment payload without appointmentId', () => {
      const payload = {
        type: 'appointment',
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).toBeNull();
    });

    it('should reject vaccination payload without vaccinationId', () => {
      const payload = {
        type: 'vaccination',
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).toBeNull();
    });

    it('should reject SOS payload without sosId', () => {
      const payload = {
        type: 'sos',
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).toBeNull();
    });

    it('should reject payload with malformed parameter types', () => {
      const payload = {
        type: 'medication',
        medicationId: 123, // Should be string
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).toBeNull();
    });

    it('should reject payload without version field', () => {
      const payload = {
        type: 'medication',
        medicationId: 'med-valid-123',
        // no version field
      };

      const result = extractDeepLinkParams(payload);
      expect(result).toBeNull();
    });

    it('should reject payload with unsupported version', () => {
      const payload = {
        type: 'medication',
        medicationId: 'med-valid-123',
        version: 99, // Unsupported version
      };

      const result = extractDeepLinkParams(payload);
      expect(result).toBeNull();
    });

    it('should ignore extra fields and use type-based routing', () => {
      const payload = {
        type: 'medication',
        medicationId: 'med-valid-123',
        version: 1,
        route: 'UnexpectedRoute', // crafted attempt to override
      };

      const result = extractDeepLinkParams(payload);
      expect(result?.route).toBe('Medications');
      // The returned route should be based on type, not crafted route field
    });

    it('should not include sensitive identifiers in logs', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const payload = {
        type: 'medication',
        medicationId: 'med-sensitive-secret-123',
        version: 1,
      };

      extractDeepLinkParams(payload);

      // Verify no console output contains the sensitive ID
      const allCalls = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(allCalls).not.toContain('med-sensitive-secret-123');

      consoleSpy.mockRestore();
    });

    it('accepts petId but post-navigation auth check required', () => {
      // The schema should accept valid petIds, but the app must verify ownership
      const payload = {
        type: 'general',
        petId: 'pet-arbitrary-uuid-456',
        version: 1,
      };

      const result = extractDeepLinkParams(payload);
      expect(result).not.toBeNull();
      // Navigation is allowed by schema, but PetDetail screen must verify user owns pet
    });
  });
});
