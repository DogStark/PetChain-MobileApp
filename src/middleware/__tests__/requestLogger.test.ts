import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { setupRequestLogger } from '../requestLogger';

describe('requestLogger', () => {
  let mockAxios: Partial<AxiosInstance>;
  let capturedLogs: Array<{ level: string; message: string }> = [];
  let requestInterceptor: ((config: any) => any) | null = null;
  let responseInterceptor: ((response: any) => any) | null = null;
  let responseErrorInterceptor: ((error: any) => Promise<any>) | null = null;

  beforeEach(() => {
    capturedLogs = [];

    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation((msg: string) => {
      capturedLogs.push({ level: 'log', message: msg });
    });
    vi.spyOn(console, 'warn').mockImplementation((msg: string) => {
      capturedLogs.push({ level: 'warn', message: msg });
    });
    vi.spyOn(console, 'error').mockImplementation((msg: string) => {
      capturedLogs.push({ level: 'error', message: msg });
    });

    // Mock Axios with interceptor setup
    mockAxios = {
      interceptors: {
        request: {
          use: vi.fn((successFn, errorFn) => {
            requestInterceptor = successFn;
          }),
        },
        response: {
          use: vi.fn((successFn, errorFn) => {
            responseInterceptor = successFn;
            responseErrorInterceptor = errorFn;
          }),
        },
      },
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('privacy safety', () => {
    it('should not log medical record IDs in request URLs', () => {
      // Setup mocks for dev environment
      vi.doMock('../../config', () => ({
        default: { isDev: true, isStaging: false },
      }));

      setupRequestLogger(mockAxios as AxiosInstance);

      const requestConfig = {
        method: 'GET',
        url: '/api/medical-records/rec-12345-abcde',
        baseURL: 'https://api.example.com',
        params: undefined,
        data: undefined,
        headers: { 'content-type': 'application/json' },
      };

      // Trigger the request interceptor
      requestInterceptor?.(requestConfig);

      // Verify logs don't contain the medical record ID
      const logContent = capturedLogs.map((l) => l.message).join('\n');
      expect(logContent).not.toContain('rec-12345-abcde');
      expect(logContent).not.toContain('/api/medical-records/rec-12345-abcde');
    });

    it('should not log pet IDs in request URLs', () => {
      vi.doMock('../../config', () => ({
        default: { isDev: true, isStaging: false },
      }));

      setupRequestLogger(mockAxios as AxiosInstance);

      const requestConfig = {
        method: 'GET',
        url: '/api/pets/pet-uuid-9876543',
        baseURL: 'https://api.example.com',
        params: undefined,
        data: undefined,
        headers: {},
      };

      requestInterceptor?.(requestConfig);

      const logContent = capturedLogs.map((l) => l.message).join('\n');
      expect(logContent).not.toContain('pet-uuid-9876543');
    });

    it('should not log sensitive query parameters', () => {
      vi.doMock('../../config', () => ({
        default: { isDev: true, isStaging: false },
      }));

      setupRequestLogger(mockAxios as AxiosInstance);

      const requestConfig = {
        method: 'GET',
        url: '/api/medical-records/search?q=diabetes&petId=abc123',
        baseURL: 'https://api.example.com',
        params: { q: 'diabetes', petId: 'abc123' },
        data: undefined,
        headers: {},
      };

      requestInterceptor?.(requestConfig);

      const logContent = capturedLogs.map((l) => l.message).join('\n');
      expect(logContent).not.toContain('diabetes');
      expect(logContent).not.toContain('abc123');
    });

    it('should not log sensitive request body fields', () => {
      vi.doMock('../../config', () => ({
        default: { isDev: true, isStaging: false },
      }));

      setupRequestLogger(mockAxios as AxiosInstance);

      const requestConfig = {
        method: 'POST',
        url: '/api/auth/login',
        baseURL: 'https://api.example.com',
        params: undefined,
        data: {
          email: 'user@example.com',
          password: 'super-secret-password-123',
          mfaToken: 'mfa-token-xyz',
        },
        headers: {},
      };

      requestInterceptor?.(requestConfig);

      const logContent = capturedLogs.map((l) => l.message).join('\n');
      expect(logContent).not.toContain('super-secret-password-123');
      expect(logContent).not.toContain('mfa-token-xyz');
    });

    it('should not log auth tokens in headers', () => {
      vi.doMock('../../config', () => ({
        default: { isDev: true, isStaging: false },
      }));

      setupRequestLogger(mockAxios as AxiosInstance);

      const requestConfig = {
        method: 'GET',
        url: '/api/users/me',
        baseURL: 'https://api.example.com',
        params: undefined,
        data: undefined,
        headers: {
          'authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          'x-api-key': 'sk-test-abc123xyz789',
        },
      };

      requestInterceptor?.(requestConfig);

      const logContent = capturedLogs.map((l) => l.message).join('\n');
      expect(logContent).not.toContain('Bearer eyJ');
      expect(logContent).not.toContain('sk-test-');
    });

    it('should not log sensitive data in error responses', () => {
      vi.doMock('../../config', () => ({
        default: { isDev: true, isStaging: false },
      }));

      setupRequestLogger(mockAxios as AxiosInstance);

      const errorConfig = {
        method: 'GET',
        url: '/api/medical-records/rec-sensitive-id',
      };

      const error: Partial<AxiosError> = {
        message: 'Request failed',
        config: errorConfig as any,
        response: {
          status: 403,
          statusText: 'Forbidden',
          data: { message: 'Access denied to record rec-sensitive-id' },
        } as AxiosResponse,
      };

      responseErrorInterceptor?.(error as AxiosError);

      const logContent = capturedLogs.map((l) => l.message).join('\n');
      expect(logContent).not.toContain('rec-sensitive-id');
    });

    it('should log route template instead of full resolved path', () => {
      vi.doMock('../../config', () => ({
        default: { isDev: true, isStaging: false },
      }));

      setupRequestLogger(mockAxios as AxiosInstance);

      const requestConfig = {
        method: 'GET',
        url: '/api/pets/12345/medical-records/67890',
        baseURL: 'https://api.example.com',
        params: undefined,
        data: undefined,
        headers: {},
      };

      requestInterceptor?.(requestConfig);

      const logContent = capturedLogs.map((l) => l.message).join('\n');
      // Should log route template, not full IDs
      expect(logContent).toContain('/pets/:petId/medical-records/:recordId');
    });

    it('should log HTTP status and duration in response', () => {
      vi.doMock('../../config', () => ({
        default: { isDev: true, isStaging: false },
      }));

      setupRequestLogger(mockAxios as AxiosInstance);

      const requestConfig = {
        method: 'POST',
        url: '/api/pets/abc123/records',
        baseURL: 'https://api.example.com',
        params: undefined,
        data: undefined,
        headers: {},
        _loggerStartedAt: Date.now() - 150, // 150ms ago
      };

      const response: Partial<AxiosResponse> = {
        status: 201,
        statusText: 'Created',
        data: { id: 'rec-456', name: 'Test Record' },
        headers: {},
        config: requestConfig as any,
      };

      responseInterceptor?.(response as AxiosResponse);

      const logContent = capturedLogs.map((l) => l.message).join('\n');
      expect(logContent).toContain('201');
      expect(logContent).toContain('durationMs');
      expect(logContent).toContain('/pets/:petId/records');
      // Should NOT log the record ID
      expect(logContent).not.toContain('rec-456');
    });
  });
});
