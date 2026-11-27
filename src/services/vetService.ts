import { resilientRequest } from './apiClient';

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
  lat: number;
  lng: number;
  address: string;
  phone: string;
  distance?: number;
}

export interface VetMessage {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content?: string;
  attachmentUrl?: string;
  attachmentType?: string;
  readAt?: string;
  createdAt: string;
}

export interface SearchVetsParams {
  lat?: number;
  lng?: number;
  /** Search radius in kilometers. */
  radius?: number;
  /** Single specialty filter (legacy). Prefer `specialties`. */
  specialty?: string;
  /** Multi-select specialty filter; joined into the `specialty` query param. */
  specialties?: string[];
  available?: boolean;
}

export async function searchVets(params: SearchVetsParams): Promise<VetProfile[]> {
  const query = new URLSearchParams();
  if (params.lat !== undefined) query.set('lat', String(params.lat));
  if (params.lng !== undefined) query.set('lng', String(params.lng));
  if (params.radius !== undefined) query.set('radius', String(params.radius));
  const specialties = params.specialties?.filter((s) => !!s) ?? [];
  if (specialties.length > 0) {
    query.set('specialty', specialties.join(','));
  } else if (params.specialty) {
    query.set('specialty', params.specialty);
  }
  if (params.available !== undefined) query.set('available', String(params.available));

  const res = await resilientRequest<{ data: VetProfile[] }>({
    method: 'GET',
    url: `/vets?${query.toString()}`,
  });
  // Ensure distance is present so callers can sort by distance by default.
  return res.data.data.map((vet) => ({
    ...vet,
    distance: vet.distance ?? computeDistanceKm(params.lat, params.lng, vet.lat, vet.lng),
  }));
}

function computeDistanceKm(
  lat1?: number,
  lng1?: number,
  lat2?: number,
  lng2?: number,
): number | undefined {
  if (lat1 === undefined || lng1 === undefined || lat2 === undefined || lng2 === undefined) {
    return undefined;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getVetSpecialties(): Promise<string[]> {
  const res = await resilientRequest<{ data: VetProfile[] }>({
    method: 'GET',
    url: '/vets/specialties',
  });
  const fromProfiles = res.data.data
    .map((vet) => vet.specialty)
    .filter((s): s is string => !!s);
  return Array.from(new Set(fromProfiles)).sort();
}

export async function getVetProfile(vetId: string): Promise<VetProfile> {
  const res = await resilientRequest<{ data: VetProfile }>({
    method: 'GET',
    url: `/vets/${vetId}`,
  });
  return res.data.data;
}

export async function getMessages(
  vetId: string,
  limit = 50,
  before?: string,
): Promise<VetMessage[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before) query.set('before', before);
  const res = await resilientRequest<{ data: VetMessage[] }>({
    method: 'GET',
    url: `/vets/messages/${vetId}?${query.toString()}`,
  });
  return res.data.data;
}

export async function sendMessage(
  vetId: string,
  payload: { content?: string; attachmentUrl?: string; attachmentType?: string },
): Promise<VetMessage> {
  const res = await resilientRequest<{ data: VetMessage }>({
    method: 'POST',
    url: `/vets/messages/${vetId}`,
    data: payload,
  });
  return res.data.data;
}
