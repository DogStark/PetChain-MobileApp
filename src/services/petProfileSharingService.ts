import axios from 'axios';
import { Share } from 'react-native';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://api.petchain.com';

export class PetSharingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PetSharingError';
  }
}

export interface PetShareLink {
  url: string;
  token: string;
  expiresAt: string;
}

export interface PetQRCode {
  qrDataUrl: string;
  shareUrl: string;
}

/**
 * Generate a time-limited shareable link for a pet profile.
 * Permissions are enforced server-side — only the pet owner can generate links.
 */
export const generatePetShareLink = async (petId: string): Promise<PetShareLink> => {
  if (!petId) throw new PetSharingError('Pet ID is required', 'INVALID_PARAMS');

  try {
    const response = await axios.post<PetShareLink>(`${API_BASE_URL}/pets/${petId}/share-link`);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 403) {
        throw new PetSharingError('You do not have permission to share this pet', 'FORBIDDEN');
      }
      throw new PetSharingError('Failed to generate share link', 'SHARE_LINK_ERROR');
    }
    throw new PetSharingError('Network error', 'NETWORK_ERROR');
  }
};

/**
 * Generate a QR code image (data URL) for a pet profile share link.
 * Permissions enforced server-side.
 */
export const generatePetQRCode = async (petId: string): Promise<PetQRCode> => {
  if (!petId) throw new PetSharingError('Pet ID is required', 'INVALID_PARAMS');

  try {
    const response = await axios.post<PetQRCode>(`${API_BASE_URL}/pets/${petId}/qr-code`);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 403) {
        throw new PetSharingError('You do not have permission to share this pet', 'FORBIDDEN');
      }
      throw new PetSharingError('Failed to generate QR code', 'QR_CODE_ERROR');
    }
    throw new PetSharingError('Network error', 'NETWORK_ERROR');
  }
};

/**
 * Trigger the native OS share sheet with the pet profile link.
 * Works for both share link and social media sharing.
 */
export const nativeSharePetProfile = async (url: string, petName: string): Promise<void> => {
  await Share.share({
    message: `Check out ${petName}'s profile on PetChain!\n${url}`,
    url,
    title: `${petName}'s PetChain Profile`,
  });
};
