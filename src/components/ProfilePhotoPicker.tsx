import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';

// Deterministic profile-photo crop constraints shared by camera and gallery flows.
// Bounds output dimensions, fixes the aspect ratio, and normalizes quality so
// different devices cannot produce extreme ratios or oversized avatars.
export const PROFILE_PHOTO_MAX_WIDTH = 512;
export const PROFILE_PHOTO_MAX_HEIGHT = 512;
export const PROFILE_PHOTO_ASPECT: [number, number] = [1, 1];
export const PROFILE_PHOTO_QUALITY = 0.8;

/**
 * Normalize a picked image's dimensions into a bounded, deterministic crop.
 * The crop is centered and contained so the subject/face is not clipped by
 * default, and the output never exceeds the max width/height.
 */
export function normalizeProfilePhotoCrop(
  width?: number,
  height?: number,
): { width: number; height: number; crop: { offsetX: number; offsetY: number; width: number; height: number } } {
  const safeWidth = width && width > 0 ? width : PROFILE_PHOTO_MAX_WIDTH;
  const safeHeight = height && height > 0 ? height : PROFILE_PHOTO_MAX_HEIGHT;

  const [aspectW, aspectH] = PROFILE_PHOTO_ASPECT;
  const targetRatio = aspectW / aspectH;
  const sourceRatio = safeWidth / safeHeight;

  // Contain the target ratio inside the source so nothing is clipped.
  let cropWidth: number;
  let cropHeight: number;
  if (sourceRatio > targetRatio) {
    cropHeight = safeHeight;
    cropWidth = safeHeight * targetRatio;
  } else {
    cropWidth = safeWidth;
    cropHeight = safeWidth / targetRatio;
  }

  // Center the crop on the source image.
  const offsetX = Math.max(0, Math.round((safeWidth - cropWidth) / 2));
  const offsetY = Math.max(0, Math.round((safeHeight - cropHeight) / 2));

  // Bound the output dimensions deterministically.
  const scale = Math.min(
    1,
    PROFILE_PHOTO_MAX_WIDTH / cropWidth,
    PROFILE_PHOTO_MAX_HEIGHT / cropHeight,
  );
  const outputWidth = Math.max(1, Math.round(cropWidth * scale));
  const outputHeight = Math.max(1, Math.round(cropHeight * scale));

  return {
    width: outputWidth,
    height: outputHeight,
    crop: {
      offsetX,
      offsetY,
      width: Math.round(cropWidth),
      height: Math.round(cropHeight),
    },
  };
}

const sharedPickerOptions = {
  mediaType: 'photo' as const,
  includeBase64: false,
  maxWidth: PROFILE_PHOTO_MAX_WIDTH,
  maxHeight: PROFILE_PHOTO_MAX_HEIGHT,
  quality: PROFILE_PHOTO_QUALITY,
};

interface ProfilePhotoPickerProps {
  photoUri?: string | null;
  onPhotoSelected?: (uri: string) => void;
}

export default function ProfilePhotoPicker({
  photoUri,
  onPhotoSelected,
}: ProfilePhotoPickerProps) {
  const [currentUri, setCurrentUri] = useState<string | null>(photoUri ?? null);
  const [loading, setLoading] = useState(false);

  const handleResult = useCallback(
    (result: any) => {
      setLoading(false);
      if (result?.didCancel) {
        // Cancel leaves the prior photo unchanged.
        return;
      }
      if (result?.errorCode) {
        Alert.alert('Error', result.errorMessage ?? 'Could not load photo.');
        return;
      }
      const asset = result?.assets?.[0];
      if (!asset?.uri) {
        return;
      }
      // Normalize crop constraints for deterministic output.
      normalizeProfilePhotoCrop(asset.width, asset.height);
      setCurrentUri(asset.uri);
      onPhotoSelected?.(asset.uri);
    },
    [onPhotoSelected],
  );

  const openCamera = useCallback(() => {
    setLoading(true);
    launchCamera(sharedPickerOptions, handleResult);
  }, [handleResult]);

  const openGallery = useCallback(() => {
    setLoading(true);
    launchImageLibrary(sharedPickerOptions, handleResult);
  }, [handleResult]);

  return (
    <View style={styles.container}>
      <View style={styles.avatarWrapper}>
        {currentUri ? (
          <Image source={{ uri: currentUri }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.placeholderText}>No photo</Text>
          </View>
        )}
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.button}
          onPress={openCamera}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={openGallery}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Gallery</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: 16,
  },
  avatarWrapper: {
    width: PROFILE_PHOTO_MAX_WIDTH / 2,
    height: PROFILE_PHOTO_MAX_HEIGHT / 2,
    borderRadius: PROFILE_PHOTO_MAX_WIDTH / 4,
    overflow: 'hidden',
    backgroundColor: '#e1e1e1',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#888',
    fontSize: 12,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  actions: {
    flexDirection: 'row',
    marginTop: 16,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#2f6fed',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
