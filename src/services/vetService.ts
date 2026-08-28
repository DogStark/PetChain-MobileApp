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
  radius?: number;
  specialty?: string;
  available?: boolean;
}

export async function searchVets(params: SearchVetsParams): Promise<VetProfile[]> {
  const query = new URLSearchParams();
  if (params.lat !== undefined) query.set('lat', String(params.lat));
  if (params.lng !== undefined) query.set('lng', String(params.lng));
  if (params.radius !== undefined) query.set('radius', String(params.radius));
  if (params.specialty) query.set('specialty', params.specialty);
  if (params.available !== undefined) query.set('available', String(params.available));

  const res = await resilientRequest<{ data: VetProfile[] }>({
    method: 'GET',
    url: `/vets?${query.toString()}`,
  });
  return res.data.data;
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
