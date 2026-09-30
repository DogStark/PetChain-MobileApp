import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import apiClient from './apiClient';

export interface UploadProgressEvent {
  loaded: number;
  total: number;
  percentage: number;
}

export type ProgressCallback = (event: UploadProgressEvent) => void;

export interface FileUploadResponse {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

const BASE_URL = '/files';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export class FileUploadError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'FileUploadError';
  }
}

function validateFile(file: File, allowedTypes: string[]) {
  if (!allowedTypes.includes(file.type)) {
    throw new FileUploadError(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new FileUploadError(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }
}

async function uploadFile(
  file: File,
  endpoint: string,
  onProgress?: ProgressCallback
): Promise<FileUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const config: AxiosRequestConfig = {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        onProgress({
          loaded: progressEvent.loaded,
          total: progressEvent.total,
          percentage: Math.round((progressEvent.loaded * 100) / progressEvent.total),
        });
      }
    },
  };

  try {
    const response: AxiosResponse<{ data: FileUploadResponse }> = await apiClient.post(
      `${BASE_URL}${endpoint}`,
      formData,
      config
    );
    return response.data.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new FileUploadError(
        error.response?.data?.message || 'Failed to upload file',
        error.response?.status
      );
    }
    throw new FileUploadError('An unexpected error occurred during file upload');
  }
}

/**
 * Uploads an image file (e.g., pet photo)
 */
export async function uploadImage(
  file: File,
  onProgress?: ProgressCallback
): Promise<FileUploadResponse> {
  validateFile(file, ALLOWED_IMAGE_TYPES);
  return uploadFile(file, '/images', onProgress);
}

/**
 * Uploads a document file (e.g., medical record)
 */
export async function uploadDocument(
  file: File,
  onProgress?: ProgressCallback
): Promise<FileUploadResponse> {
  validateFile(file, ALLOWED_DOCUMENT_TYPES);
  return uploadFile(file, '/documents', onProgress);
}

/**
 * Deletes a file by its ID
 */
export async function deleteFile(fileId: string): Promise<void> {
  try {
    await apiClient.delete(`${BASE_URL}/${fileId}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new FileUploadError(
        error.response?.data?.message || 'Failed to delete file',
        error.response?.status
      );
    }
    throw new FileUploadError('An unexpected error occurred during file deletion');
  }
}

/**
 * Gets a temporary or signed URL for a file
 */
export async function getFileUrl(fileId: string): Promise<string> {
  try {
    const response: AxiosResponse<{ data: { url: string } }> = await apiClient.get(
      `${BASE_URL}/${fileId}/url`
    );
    return response.data.data.url;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new FileUploadError(
        error.response?.data?.message || 'Failed to retrieve file URL',
        error.response?.status
      );
    }
    throw new FileUploadError('An unexpected error occurred retrieving file URL');
  }
}
