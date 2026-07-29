import type { ID, ISO8601DateString } from './common';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: ISO8601DateString;
}

export interface AuthUserProfile {
  id: ID;
  email: string;
  name?: string;
  role?: string;
  avatarUrl?: string;
}

export interface AuthState {
  user: AuthUserProfile | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface RegisterPayload extends LoginCredentials {
  name: string;
  phone?: string;
}
