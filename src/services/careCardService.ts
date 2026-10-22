import axios from 'axios';

import type { Pet } from '../models/Pet';
import { PetSharingError } from './petProfileSharingService';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://api.petchain.com';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Pet fields a care card may expose. Anything not listed here is never shared. */
export type CareCardField = 'name' | 'species' | 'breed' | 'age' | 'weightKg' | 'microchipId';

export const CARE_CARD_FIELDS: CareCardField[] = [
  'name',
  'species',
  'breed',
  'age',
  'weightKg',
  'microchipId',
];

/** Fields shared by default. Everything else stays private until the owner opts in. */
export const DEFAULT_CARE_CARD_FIELDS: CareCardField[] = ['name', 'species'];

export type CareCardExpiry = '1h' | '24h' | '7d';

export const CARE_CARD_EXPIRY_MS: Record<CareCardExpiry, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export interface CareCard {
  id: string;
  url: string;
  /** ISO-8601 timestamp after which the server refuses to serve this card. */
  expiresAt: string;
  fields: CareCardField[];
}

export interface CareCardPreviewRow {
  field: CareCardField;
  label: string;
  value: string;
}

const FIELD_LABELS: Record<CareCardField, string> = {
  name: 'Name',
  species: 'Species',
  breed: 'Breed',
  age: 'Age',
  weightKg: 'Weight',
  microchipId: 'Microchip ID',
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Build the exact rows a recipient will see. Only selected fields that the pet
 * actually has are included, in canonical order, so the preview matches what is shared.
 */
export const buildCareCardPreview = (
  pet: Pick<Pet, 'name' | 'species' | 'breed' | 'age' | 'weightKg' | 'microchipId'>,
  selected: readonly CareCardField[],
): CareCardPreviewRow[] => {
  const rows: CareCardPreviewRow[] = [];
  for (const field of CARE_CARD_FIELDS) {
    if (!selected.includes(field)) continue;
    const raw = pet[field];
    if (raw === undefined || raw === null || raw === '') continue;
    const value =
      field === 'weightKg' ? `${raw} kg` : field === 'age' ? `${raw} yrs` : String(raw);
    rows.push({ field, label: FIELD_LABELS[field], value });
  }
  return rows;
};

/** A card is usable only while the clock is before its server-confirmed expiry. */
export const isCareCardExpired = (
  card: Pick<CareCard, 'expiresAt'>,
  now: number = Date.now(),
) => new Date(card.expiresAt).getTime() <= now;

// ─── Server calls ─────────────────────────────────────────────────────────────

/**
 * Create a care card with only the selected fields. The server enforces
 * ownership and returns the authoritative expiry; nothing is treated as shared
 * until the server confirms it, and nothing is cached locally.
 */
export const createCareCard = async (
  petId: string,
  fields: CareCardField[],
  expiry: CareCardExpiry,
): Promise<CareCard> => {
  if (!petId) throw new PetSharingError('Pet ID is required', 'INVALID_PARAMS');
  const safeFields = CARE_CARD_FIELDS.filter((f) => fields.includes(f));
  if (safeFields.length === 0) {
    throw new PetSharingError('Select at least one field', 'INVALID_PARAMS');
  }

  try {
    const response = await axios.post<CareCard>(
      `${API_BASE_URL}/pets/${encodeURIComponent(petId)}/care-cards`,
      { fields: safeFields, expiresIn: CARE_CARD_EXPIRY_MS[expiry] },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 403) {
        throw new PetSharingError('You do not have permission to share this pet', 'FORBIDDEN');
      }
      if (!error.response) {
        throw new PetSharingError('Network error', 'NETWORK_ERROR');
      }
      throw new PetSharingError('Failed to create care card', 'CARE_CARD_ERROR');
    }
    throw new PetSharingError('Network error', 'NETWORK_ERROR');
  }
};

/**
 * Revoke a care card on the server. Throws on failure so the UI never claims a
 * card is revoked while it is still live.
 */
export const revokeCareCard = async (cardId: string): Promise<void> => {
  if (!cardId) throw new PetSharingError('Card ID is required', 'INVALID_PARAMS');

  try {
    await axios.delete(`${API_BASE_URL}/care-cards/${encodeURIComponent(cardId)}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) return;
      if (!error.response) {
        throw new PetSharingError('Network error', 'NETWORK_ERROR');
      }
    }
    throw new PetSharingError('Failed to revoke care card', 'CARE_CARD_ERROR');
  }
};
