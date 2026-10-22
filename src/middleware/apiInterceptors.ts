import {
  type AxiosInstance,
  type AxiosError,
  type InternalAxiosRequestConfig,
  type AxiosResponse,
} from 'axios';

import { applySchemaMapping } from './schemaMapper';
import { getItem, setItem, removeItem } from '../services/localDB';
import { recordApiTiming } from '../services/performanceService';

const ACCESS_TOKEN_KEY = '@access_token';
const REFRESH_TOKEN_KEY = '@refresh_token';

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

export const setupInterceptors = (apiClient: AxiosInstance): void => {
  type TimedConfig = InternalAxiosRequestConfig & { metadata?: { startedAt: number } };

  // Request: auth token injection
  apiClient.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      const token = await getItem(ACCESS_TOKEN_KEY);
      if (token) config.headers.Authorization = `Bearer ${token}`;
      (config as TimedConfig).metadata = { startedAt: Date.now() };
      return config;
    },
    (error: AxiosError) => Promise.reject(error),
  );

  // Request: logging (dev only)
  apiClient.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      return config;
    },
    (error: AxiosError) => {
      console.error('[API] Request error:', error.message);
      return Promise.reject(error);
    },
  );

  // Response: logging + error handling + token refresh
  apiClient.interceptors.response.use(
    (response: AxiosResponse) => {
      return applySchemaMapping(response);
    },
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

      console.error(`[API] Error ${error.response?.status ?? 'network'}: ${originalRequest?.url}`);

      // Token refresh on 401
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        try {
          const refreshToken = await getItem(REFRESH_TOKEN_KEY);
          if (!refreshToken) return Promise.reject(error);

          const { data } = await apiClient.post<TokenResponse>('/auth/refresh', { refreshToken });

          await Promise.all([
            setItem(ACCESS_TOKEN_KEY, data.accessToken),
            setItem(REFRESH_TOKEN_KEY, data.refreshToken),
          ]);

          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
          return apiClient(originalRequest);
        } catch {
          await Promise.all([removeItem(ACCESS_TOKEN_KEY), removeItem(REFRESH_TOKEN_KEY)]);
        }
      }

      // Consistent error message
      const message = error.response
        ? `Request failed with status ${error.response.status}`
        : (error.message ?? 'Network error');

      const startedAt = (error.config as TimedConfig | undefined)?.metadata?.startedAt;
      if (startedAt) {
        await recordApiTiming(
          originalRequest?.url ?? 'unknown',
          originalRequest?.method ?? 'get',
          Date.now() - startedAt,
          error.response?.status,
        );
      }
      return Promise.reject(new Error(message));
    },
  );
};
