/**
 * Vet clinic directory (#1396). Clinic addresses are geocoded to lat/lng on
 * create and whenever the address changes, so proximity search on
 * GET /api/vets?lat=&lng=&radius= is accurate.
 */

import { v4 as uuidv4 } from 'uuid';

import { geocodeAddress } from './geocodingService';

export interface VetProfile {
  id: string;
  userId: string;
  name: string;
  specialty: string;
  credentials: string;
  acceptedInsurance: string[];
  rating: number;
  reviewCount: number;
  available: boolean;
  /** Null when the address could not be geocoded yet. */
  lat: number | null;
  lng: number | null;
  address: string;
  phone: string;
}

export type CreateVetProfileInput = Partial<
  Pick<VetProfile, 'name' | 'specialty' | 'credentials' | 'acceptedInsurance' | 'address' | 'phone'>
> & { lat?: number; lng?: number };

export type UpdateVetProfileInput = Partial<
  Pick<
    VetProfile,
    'name' | 'specialty' | 'credentials' | 'acceptedInsurance' | 'address' | 'phone' | 'available'
  >
>;

const vetProfiles = new Map<string, VetProfile>();

function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

/** Creates a clinic profile, geocoding its address. */
export async function createVetProfile(
  userId: string,
  fallbackName: string,
  input: CreateVetProfileInput,
): Promise<VetProfile> {
  const address = input.address?.trim() ?? '';
  let lat: number | null = isCoordinate(input.lat, 90) ? input.lat : null;
  let lng: number | null = isCoordinate(input.lng, 180) ? input.lng : null;

  if (address) {
    const coords = await geocodeAddress(address);
    if (coords) {
      lat = coords.lat;
      lng = coords.lng;
    }
  }

  const profile: VetProfile = {
    id: uuidv4(),
    userId,
    name: input.name ?? fallbackName,
    specialty: input.specialty ?? 'General',
    credentials: input.credentials ?? '',
    acceptedInsurance: input.acceptedInsurance ?? [],
    rating: 0,
    reviewCount: 0,
    available: true,
    lat,
    lng,
    address,
    phone: input.phone ?? '',
  };
  vetProfiles.set(profile.id, profile);
  return profile;
}

/** Updates a clinic profile; re-geocodes only when the address changed. */
export async function updateVetProfile(
  id: string,
  input: UpdateVetProfileInput,
): Promise<VetProfile | null> {
  const existing = vetProfiles.get(id);
  if (!existing) return null;

  const next: VetProfile = { ...existing, ...input };
  const newAddress = input.address?.trim();
  if (newAddress !== undefined && newAddress !== existing.address) {
    next.address = newAddress;
    const coords = newAddress ? await geocodeAddress(newAddress) : null;
    next.lat = coords?.lat ?? null;
    next.lng = coords?.lng ?? null;
  }
  vetProfiles.set(id, next);
  return next;
}

export function getVetProfile(id: string): VetProfile | undefined {
  return vetProfiles.get(id);
}

export function listVetProfiles(): VetProfile[] {
  return [...vetProfiles.values()];
}

/**
 * One-time backfill: geocodes clinics that have an address but no
 * coordinates. Returns how many profiles were updated.
 */
export async function backfillVetCoordinates(): Promise<number> {
  let updated = 0;
  for (const profile of vetProfiles.values()) {
    if (profile.lat !== null && profile.lng !== null) continue;
    if (!profile.address) continue;
    const coords = await geocodeAddress(profile.address);
    if (!coords) continue;
    vetProfiles.set(profile.id, { ...profile, lat: coords.lat, lng: coords.lng });
    updated += 1;
  }
  return updated;
}

/** Test helper. */
export function _resetVetProfiles(): void {
  vetProfiles.clear();
}

export default {
  createVetProfile,
  updateVetProfile,
  getVetProfile,
  listVetProfiles,
  backfillVetCoordinates,
};
