import { Platform } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import ImageResizer from 'react-native-image-resizer';

export interface ImagePickerResult {
  uri: string;
  type: string;
  name: string;
  size: number;
}

export interface CompressedImage {
  uri: string;
  size: number;
  width: number;
  height: number;
}

export interface ImageUploadResult {
  url: string;
  thumbnailUrl?: string;
}

export const pickImage = async (): Promise<ImagePickerResult | null> => {
  try {
    return new Promise((resolve) => {
      launchImageLibrary(
        { mediaType: 'photo', quality: 0.8, maxWidth: 2000, maxHeight: 2000 },
        (response) => {
          if (response.didCancel || response.errorMessage || !response.assets?.[0]) {
            resolve(null);
            return;
          }
          const asset = response.assets[0];
          resolve({
            uri: asset.uri ?? '',
            type: asset.type || 'image/jpeg',
            name: asset.fileName || 'photo.jpg',
            size: asset.fileSize || 0,
          });
        },
      );
    });
  } catch (error) {
    console.error('Image picker error:', error);
    return null;
  }
};

export const compressImage = async (uri: string): Promise<CompressedImage> => {
  try {
    const result = await ImageResizer.createResizedImage(
      uri,
      800,
      600,
      'JPEG',
      80,
      0,
      undefined,
      false,
      { mode: 'contain' },
    );
    return {
      uri: result.uri,
      size: result.size || 0,
      width: result.width || 800,
      height: result.height || 600,
    };
  } catch (error) {
    console.error('Image compression error:', error);
    return { uri, size: 0, width: 800, height: 600 };
  }
};

export const generateThumbnail = async (uri: string): Promise<string> => {
  try {
    const result = await ImageResizer.createResizedImage(
      uri,
      150,
      150,
      'JPEG',
      70,
      0,
      undefined,
      false,
      { mode: 'cover' },
    );
    return result.uri;
  } catch (error) {
    console.error('Thumbnail generation error:', error);
    return uri;
  }
};

export const uploadToStorage = async (
  imageUri: string,
  petId: string,
): Promise<ImageUploadResult> => {
  try {
    const formData = new FormData();
    formData.append('file', {
      uri: Platform.OS === 'ios' ? imageUri.replace('file://', '') : imageUri,
      type: 'image/jpeg',
      name: `pet-${petId}-${Date.now()}.jpg`,
    } as unknown as Blob);

    const response = await fetch('/api/upload/pet-photo', {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    return { url: result.url, thumbnailUrl: result.thumbnailUrl };
  } catch (error) {
    console.error('Upload error:', error);
    throw new Error('Failed to upload image');
  }
};
