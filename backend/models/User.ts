import { UserRole } from './UserRole';

export { UserRole };

/**
 * Authentication providers supported by the backend.
 */
export type AuthProvider = 'local' | 'google' | 'apple';

/**
 * Lightweight reference to a pet owned by a user.
 * This keeps the user model API-friendly and avoids deep nested payloads.
 */
export interface PetReference {
  id: string;
  name?: string;
}

/**
 * Core user model returned by backend APIs.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  pets: PetReference[];
  createdAt: string;
  updatedAt: string;

  // Authentication-related fields
  passwordHash?: string;
  authProvider: AuthProvider;
  isEmailVerified: boolean;
  lastLoginAt?: string;

  /** Hex-encoded ECDH (P-256) public key for E2E-encrypted telemedicine chat. */
  chatPublicKey?: string;
  /** ISO timestamp of the last key rotation. */
  chatPublicKeyUpdatedAt?: string;
}

/**
 * Payload used when creating a user record.
 */
export interface CreateUserInput {
  email: string;
  name: string;
  password?: string;
  phone?: string;
  role?: UserRole;
  authProvider?: AuthProvider;
}

/**
 * Payload used for login operations.
 */
export interface UserLoginInput {
  email: string;
  password: string;
}

/**
 * Payload used to update editable user profile fields.
 */
export interface UpdateUserInput {
  name?: string;
  phone?: string;
  role?: UserRole;
  pets?: PetReference[];
  isEmailVerified?: boolean;
  /** Hex-encoded ECDH public key used for E2E-encrypted telemedicine chat. */
  chatPublicKey?: string;
}
