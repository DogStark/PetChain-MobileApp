import React, { useState } from 'react';
import { View, TouchableOpacity, Image, Text, Alert } from 'react-native';

import petService from '../services/petService';

interface PetPhotoUploaderProps {
  petId: string;
  currentPhotoUrl?: string;
  onPhotoUploaded?: (url: string) => void;
}

export const PetPhotoUploader: React.FC<PetPhotoUploaderProps> = ({
  petId,
  currentPhotoUrl,
  onPhotoUploaded,
}) => {
  const [uploading, setUploading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(currentPhotoUrl);

  const handleUpload = async () => {
    try {
      setUploading(true);
      const url = await petService.uploadPetPhoto(petId);

      if (url) {
        setPhotoUrl(url);
        onPhotoUploaded?.(url);
      }
    } catch {
      Alert.alert('Upload Failed', 'Could not upload photo. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <TouchableOpacity onPress={handleUpload} disabled={uploading}>
      <View style={{ width: 120, height: 120, backgroundColor: '#f0f0f0', borderRadius: 8 }}>
        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
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
