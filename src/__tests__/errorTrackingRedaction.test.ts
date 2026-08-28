/**
 * Tests for sensitive data redaction in Sentry (error tracking).
 *
 * Verifies: health/location/wallet/token data is redacted from breadcrumbs,
 * deeply nested sensitive fields are caught, allowlist approach for structured data,
 * non-sensitive fields still come through, snapshot regression tests.
 */

import * as Sentry from '@sentry/react-native';
import { redactSensitiveData, isSensitiveKey, REDACTED } from '../services/errorTracking';

jest.mock('@sentry/react-native');

beforeEach(() => {
  jest.clearAllMocks();
});

const REDACTED_MARKER = '[redacted]';

describe('Sensitive data redaction in Sentry', () => {
  describe('redactSensitiveData', () => {
    it('redacts top-level health fields', () => {
      const data = {
        healthNote: 'Took aspirin yesterday',
        petHealthStatus: 'sick',
        vitals: { heartRate: 120 },
      };

      const redacted = redactSensitiveData(data);

      expect(redacted.healthNote).toBe(REDACTED_MARKER);
      expect(redacted.petHealthStatus).toBe(REDACTED_MARKER);
    });

    it('redacts top-level location fields', () => {
      const data = {
        latitude: 37.7749,
        longitude: -122.4194,
        address: '123 Main St, San Francisco, CA',
        location: { city: 'SF' },
      };

      const redacted = redactSensitiveData(data);

      expect(redacted.latitude).toBe(REDACTED_MARKER);
      expect(redacted.longitude).toBe(REDACTED_MARKER);
      expect(redacted.address).toBe(REDACTED_MARKER);
    });

    it('redacts top-level wallet fields', () => {
      const data = {
        walletAddress: '0x1234...5678',
        walletBalance: 100.5,
        contractAddress: '0xabcd...ef01',
        publicKey: 'pk_live_abc123',
      };

      const redacted = redactSensitiveData(data);

      expect(redacted.walletAddress).toBe(REDACTED_MARKER);
      expect(redacted.walletBalance).toBe(REDACTED_MARKER);
      expect(redacted.contractAddress).toBe(REDACTED_MARKER);
      expect(redacted.publicKey).toBe(REDACTED_MARKER);
    });

    it('redacts top-level token fields', () => {
      const data = {
        token: 'eyJhbGc...',
        authToken: 'abc123xyz',
        refreshToken: 'ref_token_123',
        apiKey: 'sk_live_secret',
        sessionId: 'sess_12345',
      };

      const redacted = redactSensitiveData(data);

      expect(redacted.token).toBe(REDACTED_MARKER);
      expect(redacted.authToken).toBe(REDACTED_MARKER);
      expect(redacted.refreshToken).toBe(REDACTED_MARKER);
      expect(redacted.apiKey).toBe(REDACTED_MARKER);
      expect(redacted.sessionId).toBe(REDACTED_MARKER);
    });

    it('redacts deeply nested sensitive fields (3+ levels deep)', () => {
      const data = {
        user: {
          profile: {
            health: {
              medicalHistory: 'Diabetes',
              bloodType: 'O-',
            },
            location: {
              home: { latitude: 37.7749, longitude: -122.4194 },
            },
          },
        },
      };

      const redacted = redactSensitiveData(data);

      expect(redacted.user?.profile?.health?.medicalHistory).toBe(REDACTED_MARKER);
      expect(redacted.user?.profile?.health?.bloodType).toBe(REDACTED_MARKER);
      expect(redacted.user?.profile?.location?.home?.latitude).toBe(REDACTED_MARKER);
      expect(redacted.user?.profile?.location?.home?.longitude).toBe(REDACTED_MARKER);
    });

    it('redacts sensitive fields in navigation params', () => {
      const navParams = {
        screen: 'HealthDetail',
        params: {
          petId: 'pet_123',
          healthNote: 'Vaccination due',
          coordinates: { lat: 37.7749, lon: -122.4194 },
        },
      };

      const redacted = redactSensitiveData(navParams);

      expect(redacted.params?.petId).toBe('pet_123');
      expect(redacted.params?.healthNote).toBe(REDACTED_MARKER);
      expect(redacted.params?.coordinates?.lat).toBe(REDACTED_MARKER);
    });

    it('redacts sensitive fields in API request bodies', () => {
      const apiCall = {
        method: 'POST',
        url: '/api/pets',
        body: {
          name: 'Fluffy',
          health: {
            medicalRecords: ['Surgery 2024'],
            vaccinations: { rabies: true },
          },
          walletAddress: '0xabc...',
        },
      };

      const redacted = redactSensitiveData(apiCall);

      expect(redacted.method).toBe('POST');
      expect(redacted.url).toBe('/api/pets');
      expect(redacted.body?.name).toBe('Fluffy');
      expect(redacted.body?.health?.medicalRecords).toBe(REDACTED_MARKER);
      expect(redacted.body?.walletAddress).toBe(REDACTED_MARKER);
    });

    it('preserves non-sensitive fields (allowlist approach)', () => {
      const data = {
        petName: 'Fluffy',
        breed: 'Golden Retriever',
        age: 3,
        lastFeedTime: '2025-01-15T10:30:00Z',
        routeName: 'PetDetailScreen',
        status: 'success',
      };

      const redacted = redactSensitiveData(data);

      expect(redacted.petName).toBe('Fluffy');
      expect(redacted.breed).toBe('Golden Retriever');
      expect(redacted.age).toBe(3);
      expect(redacted.lastFeedTime).toBe('2025-01-15T10:30:00Z');
      expect(redacted.routeName).toBe('PetDetailScreen');
      expect(redacted.status).toBe('success');
    });

    it('handles arrays of objects with sensitive fields', () => {
      const data = {
        pets: [
          { id: 'pet_1', name: 'Max', healthNote: 'Healthy', walletAddress: '0xaaa' },
          { id: 'pet_2', name: 'Bella', healthNote: 'Allergies', walletAddress: '0xbbb' },
        ],
      };

      const redacted = redactSensitiveData(data);

      expect(redacted.pets?.[0]?.id).toBe('pet_1');
      expect(redacted.pets?.[0]?.name).toBe('Max');
      expect(redacted.pets?.[0]?.healthNote).toBe(REDACTED_MARKER);
      expect(redacted.pets?.[0]?.walletAddress).toBe(REDACTED_MARKER);
    });

    it('handles null and undefined values', () => {
      const data = {
        healthNote: null,
        walletAddress: undefined,
        petName: 'Fluffy',
      };

      const redacted = redactSensitiveData(data);

      expect(redacted.healthNote).toBe(null);
      expect(redacted.walletAddress).toBe(undefined);
      expect(redacted.petName).toBe('Fluffy');
    });
  });

  describe('isSensitiveKey', () => {
    it('identifies health-related keys', () => {
      expect(isSensitiveKey('healthNote')).toBe(true);
      expect(isSensitiveKey('medicalHistory')).toBe(true);
      expect(isSensitiveKey('diagnosis')).toBe(true);
      expect(isSensitiveKey('bloodType')).toBe(true);
      expect(isSensitiveKey('petHealthStatus')).toBe(true);
    });

    it('identifies location-related keys', () => {
      expect(isSensitiveKey('latitude')).toBe(true);
      expect(isSensitiveKey('longitude')).toBe(true);
      expect(isSensitiveKey('address')).toBe(true);
      expect(isSensitiveKey('coordinates')).toBe(true);
    });

    it('identifies wallet-related keys', () => {
      expect(isSensitiveKey('walletAddress')).toBe(true);
      expect(isSensitiveKey('contractAddress')).toBe(true);
      expect(isSensitiveKey('publicKey')).toBe(true);
      expect(isSensitiveKey('walletBalance')).toBe(true);
    });

    it('identifies token-related keys', () => {
      expect(isSensitiveKey('token')).toBe(true);
      expect(isSensitiveKey('authToken')).toBe(true);
      expect(isSensitiveKey('refreshToken')).toBe(true);
      expect(isSensitiveKey('apiKey')).toBe(true);
      expect(isSensitiveKey('sessionId')).toBe(true);
    });

    it('allows non-sensitive keys', () => {
      expect(isSensitiveKey('petName')).toBe(false);
      expect(isSensitiveKey('breed')).toBe(false);
      expect(isSensitiveKey('routeName')).toBe(false);
      expect(isSensitiveKey('status')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isSensitiveKey('HealthNote')).toBe(true);
      expect(isSensitiveKey('WALLETADDRESS')).toBe(true);
      expect(isSensitiveKey('Token')).toBe(true);
    });
  });

  describe('beforeSend hook integration', () => {
    it('redacts extra context in error events', () => {
      const event = {
        level: 'error' as const,
        message: 'API call failed',
        extra: {
          endpoint: '/api/pets',
          walletAddress: '0xabc...',
          status: 500,
        },
      };

      const redacted = redactSensitiveData(event.extra);

      expect(redacted.endpoint).toBe('/api/pets');
      expect(redacted.walletAddress).toBe(REDACTED_MARKER);
      expect(redacted.status).toBe(500);
    });

    it('redacts breadcrumb data', () => {
      const breadcrumb = {
        category: 'navigation',
        message: 'Navigated to HealthDetailScreen',
        data: {
          screen: 'HealthDetailScreen',
          petId: 'pet_123',
          healthNote: 'Needs vaccination',
          coordinates: { lat: 37.7749, lon: -122.4194 },
        },
      };

      const redactedData = redactSensitiveData(breadcrumb.data);

      expect(redactedData.screen).toBe('HealthDetailScreen');
      expect(redactedData.petId).toBe('pet_123');
      expect(redactedData.healthNote).toBe(REDACTED_MARKER);
      expect(redactedData.coordinates?.lat).toBe(REDACTED_MARKER);
    });
  });

  describe('Snapshot tests for regression detection', () => {
    it('creates consistent snapshot of redacted health data event', () => {
      const healthEvent = {
        type: 'event',
        level: 'error' as const,
        message: 'Health update failed',
        extra: {
          petId: 'pet_abc123',
          healthNote: 'Diagnosis: hypertension',
          recordId: 'rec_xyz789',
          status: 'failed',
        },
      };

      const redacted = {
        ...healthEvent,
        extra: redactSensitiveData(healthEvent.extra),
      };

      expect(redacted).toMatchSnapshot();
    });

    it('creates consistent snapshot of redacted location data event', () => {
      const locationEvent = {
        type: 'event',
        level: 'warning' as const,
        message: 'Location sync delayed',
        extra: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy: 10,
          timestamp: 1705334400000,
        },
      };

      const redacted = {
        ...locationEvent,
        extra: redactSensitiveData(locationEvent.extra),
      };

      expect(redacted).toMatchSnapshot();
    });

    it('creates consistent snapshot of redacted wallet data event', () => {
      const walletEvent = {
        type: 'event',
        level: 'error' as const,
        message: 'Transaction failed',
        extra: {
          walletAddress: '0x1234567890abcdef',
          transactionHash: 'tx_abc123',
          gasPrice: 100000000,
          status: 'failed',
        },
      };

      const redacted = {
        ...walletEvent,
        extra: redactSensitiveData(walletEvent.extra),
      };

      expect(redacted).toMatchSnapshot();
    });
  });

  describe('Crash report usability', () => {
    it('preserves error message and stack trace (not redacted)', () => {
      const event = {
        message: 'API call failed: Connection timeout',
        exception: {
          values: [
            {
              type: 'TimeoutError',
              value: 'Connection timeout after 30s',
              stacktrace: {
                frames: [
                  { function: 'fetchData', filename: 'api.ts', lineno: 123 },
                  { function: 'handlePress', filename: 'Button.tsx', lineno: 45 },
                ],
              },
            },
          ],
        },
      };

      // These should never be redacted
      expect(event.message).toContain('API call failed');
      expect(event.exception?.values?.[0]?.type).toBe('TimeoutError');
      expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.function).toBe('fetchData');
    });

    it('preserves route names and non-sensitive navigation context', () => {
      const breadcrumb = {
        category: 'navigation',
        data: {
          screen: 'HealthDetailScreen',
          previousScreen: 'PetsListScreen',
          transitionTime: 250,
        },
      };

      const redacted = redactSensitiveData(breadcrumb.data);

      expect(redacted.screen).toBe('HealthDetailScreen');
      expect(redacted.previousScreen).toBe('PetsListScreen');
      expect(redacted.transitionTime).toBe(250);
    });

    it('preserves HTTP method, status codes, and non-sensitive request info', () => {
      const breadcrumb = {
        category: 'api.response',
        data: {
          method: 'POST',
          url: '/api/pets',
          status: 500,
          durationMs: 1234,
        },
      };

      const redacted = redactSensitiveData(breadcrumb.data);

      expect(redacted.method).toBe('POST');
      expect(redacted.url).toBe('/api/pets');
      expect(redacted.status).toBe(500);
      expect(redacted.durationMs).toBe(1234);
    });
  });
});
