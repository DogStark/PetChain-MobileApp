import axios from 'axios';
import { Share } from 'react-native';

import { MedicalRecordError } from './medicalRecordService';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://api.petchain.com';

export interface ShareableLink {
  url: string;
  token: string;
  expiresAt: string;
}

export interface PdfExportResult {
  downloadUrl: string;
  filename: string;
}

// Request a time-limited signed token from the backend and return the secure URL
export const generateShareableLink = async (
  petId: string,
  recordId: string,
): Promise<ShareableLink> => {
  if (!petId || !recordId) {
    throw new MedicalRecordError('Pet ID and Record ID are required', 'INVALID_PARAMS');
  }

  try {
    const response = await axios.post<ShareableLink>(
      `${API_BASE_URL}/pets/${petId}/medical-records/${recordId}/share-link`,
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new MedicalRecordError('Failed to generate share link', 'SHARE_LINK_ERROR');
    }
    throw new MedicalRecordError('Network error', 'NETWORK_ERROR');
  }
};

// Request a PDF export and return the signed download URL
export const exportRecordAsPdf = async (
  petId: string,
  recordId: string,
): Promise<PdfExportResult> => {
  if (!petId || !recordId) {
    throw new MedicalRecordError('Pet ID and Record ID are required', 'INVALID_PARAMS');
  }

  try {
    const response = await axios.post<PdfExportResult>(
      `${API_BASE_URL}/pets/${petId}/medical-records/${recordId}/export-pdf`,
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new MedicalRecordError('Failed to export PDF', 'PDF_EXPORT_ERROR');
    }
    throw new MedicalRecordError('Network error', 'NETWORK_ERROR');
  }
};

// Send the record directly to a vet by their ID via the backend
export const shareRecordWithVet = async (
  petId: string,
  recordId: string,
  vetId: string,
): Promise<void> => {
  if (!petId || !recordId || !vetId) {
    throw new MedicalRecordError('Pet ID, Record ID and Vet ID are required', 'INVALID_PARAMS');
  }

  try {
    await axios.post(`${API_BASE_URL}/pets/${petId}/medical-records/${recordId}/share-with-vet`, {
      vetId,
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new MedicalRecordError('Failed to share with vet', 'VET_SHARE_ERROR');
    }
    throw new MedicalRecordError('Network error', 'NETWORK_ERROR');
  }
};

// Trigger the native OS share sheet with the given URL
export const nativeShare = async (url: string, message?: string): Promise<void> => {
  await Share.share({ message: message ? `${message}\n${url}` : url, url });
};
