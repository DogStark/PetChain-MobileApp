/**
 * Owner (pet owner / app user) model for mobile app.
 */

import type { Pet } from './Pet';

/**
 * Postal address of an owner.
 */
export interface OwnerAddress {
  /** Street line, e.g. "12 Baker Street" */
  street: string;
  /** City or town */
  city: string;
  /** State, province or region */
  state?: string;
  /** Postal / ZIP code */
  postalCode?: string;
  /** ISO 3166-1 alpha-2 country code, e.g. "NG" */
  country: string;
}

/**
 * A pet owner's full profile as returned by the backend `/owners` API.
 */
export interface Owner {
  /** Unique owner identifier */
  id: string;
  /** Login email address (unique) */
  email: string;
  /** Full display name */
  name: string;
  /** Contact phone number in E.164 format, e.g. "+2348012345678" */
  phone?: string;
  /** Home address, used for vet visits and emergencies */
  address?: OwnerAddress;
  /** Remote URL of the owner's avatar */
  avatarUrl?: string;
  /** Pets linked to this owner */
  pets: Pet[];
  /** Whether the email address has been verified */
  emailVerified?: boolean;
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last-update timestamp */
  updatedAt?: string;
}

/**
 * The subset of `Owner` kept in auth state after login.
 * Deliberately small — no pet list, no address.
 */
export type AuthUser = Pick<Owner, 'id' | 'email' | 'name' | 'avatarUrl'> & {
  /** Ids of the pets this user owns */
  petIds: string[];
};

/**
 * Fields an owner can edit on their own profile.
 */
export type OwnerFormData = Pick<Owner, 'name' | 'phone' | 'address' | 'avatarUrl'>;

/**
 * Build an `AuthUser` from a full owner record.
 */
export const toAuthUser = (owner: Owner): AuthUser => ({
  id: owner.id,
  email: owner.email,
  name: owner.name,
  avatarUrl: owner.avatarUrl,
  petIds: (owner.pets ?? []).map(pet => pet.id),
});

/**
 * Factory to safely create an Owner from raw data, filling required
 * fields with sensible defaults.
 */
export const createOwner = (data: Partial<Owner>): Owner => ({
  id: data.id || '',
  email: data.email || '',
  name: data.name || 'Unknown Owner',
  phone: data.phone,
  address: data.address,
  avatarUrl: data.avatarUrl,
  pets: data.pets ?? [],
  emailVerified: data.emailVerified ?? false,
  createdAt: data.createdAt || new Date().toISOString(),
  updatedAt: data.updatedAt,
});

/**
 * Validate owner profile input. Returns a list of human-readable errors —
 * empty when the input is valid.
 */
export const validateOwner = (data: Partial<Owner>): string[] => {
  const errors: string[] = [];

  if (!data.name?.trim()) {
    errors.push('Name is required');
  }

  if (!data.email?.trim()) {
    errors.push('Email is required');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push('Email format is invalid');
  }

  if (data.phone && !/^\+?[0-9]{7,15}$/.test(data.phone)) {
    errors.push('Phone number must be 7-15 digits, optionally prefixed with +');
  }

  return errors;
};
