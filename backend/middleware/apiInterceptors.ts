import AsyncStorage from '@react-native-async-storage/async-storage';
import { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios';

const ACCESS_TOKEN_KEY = '@access_token';
const REFRESH_TOKEN_KEY = '@refresh_token';

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

/**
 * Setup request and response interceptors for an Axios instance.
 *
 * - Request Interceptor: Injects the access token into the Authorization header.
 * - Response Interceptor: Handles 401 errors by attempting to refresh the token and retrying the request.
 *
 * @param apiClient The Axios instance to apply interceptors to.
 */
export const setupInterceptors = (apiClient: AxiosInstance): void => {
  // Request Interceptor: Attach JWT token to headers
  apiClient.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      try {
        const token = await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      } catch (error) {
        console.error('Interceptor Request Error: Failed to fetch token from storage', error);
      }
      return config;
    },
    (error: AxiosError) => {
      return Promise.reject(error);
    },
  );

  // Response Interceptor: Handle 401 errors and automatic token refresh
  apiClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      // Typing for retry state to avoid infinite loops
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

      // If error is 401 and we haven't retried yet
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        try {
          const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);

          if (!refreshToken) {
            // No refresh token available, cannot proceed with refresh
            return Promise.reject(error);
          }

          // Attempt to refresh the access token
          // Note: We use the API client itself, but the '_retry' flag (or passing it in config)
          // should be handled if the refresh endpoint itself requires different auth or could 401.
          const response = await apiClient.post<TokenResponse>('/auth/refresh', {
            refreshToken,
          });

          const { accessToken, refreshToken: newRefreshToken } = response.data;

          // Store the new tokens
          await Promise.all([
            AsyncStorage.setItem(ACCESS_TOKEN_KEY, accessToken),
            AsyncStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken),
          ]);

          // Update the auth header for the retry
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          }

          // Retry the original request with the new token
          return apiClient(originalRequest);
        } catch (refreshError) {
          // Token refresh failed (e.g., refresh token expired)
          // Clear tokens to force a full re-login
          await Promise.all([
            AsyncStorage.removeItem(ACCESS_TOKEN_KEY),
            AsyncStorage.removeItem(REFRESH_TOKEN_KEY),
          ]);

          // Propagate the refresh error or the original 401
          return Promise.reject(refreshError);
        }
      }

      // Handle other errors gracefully
      return Promise.reject(error);
    },
  );
};
