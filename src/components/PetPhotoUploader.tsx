import React, { useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';

import { OptimizedImage } from './OptimizedImage';
import petService from '../services/petService';

interface PetPhotoUploaderProps {
  petId: string;
  currentPhotoUrl?: string;
  currentThumbnailUrl?: string;
  onPhotoUploaded?: (url: string) => void;
}

export const PetPhotoUploader: React.FC<PetPhotoUploaderProps> = ({
  petId,
  currentPhotoUrl,
  currentThumbnailUrl,
  onPhotoUploaded,
}) => {
  const [photoUrl, setPhotoUrl] = useState(currentPhotoUrl);
  const [thumbnailUrl, setThumbnailUrl] = useState(currentThumbnailUrl);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    setUploading(true);
    try {
      const result = await petService.uploadPetPhoto(petId);
      if (result) {
        setPhotoUrl(result.photoUrl);
        setThumbnailUrl(result.thumbnailUrl);
        onPhotoUploaded?.(result.photoUrl);
      }
    } catch {
      Alert.alert('Upload Failed', 'Could not upload photo. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={handleUpload}
      disabled={uploading}
      accessibilityRole="button"
      accessibilityLabel={photoUrl ? 'Change pet photo' : 'Add pet photo'}
      accessibilityHint={uploading ? 'Uploading photo' : 'Opens photo picker'}
    >
      <View style={{ width: 120, height: 120, backgroundColor: '#f0f0f0', borderRadius: 8 }}>
        {photoUrl ? (
          <OptimizedImage
            uri={photoUrl}
            thumbnailUri={thumbnailUrl}
            style={{ width: '100%', height: '100%', borderRadius: 8 }}
            resizeMode="cover"
          />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text>{uploading ? 'Uploading...' : 'Add Photo'}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};
