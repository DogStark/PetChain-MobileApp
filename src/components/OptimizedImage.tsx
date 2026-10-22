import React, { useState, useEffect } from 'react';
import { Image, type ImageProps, View, ActivityIndicator, StyleSheet } from 'react-native';

import { cacheManager } from '../../backend/services/cacheManager';
import { getItem } from '../services/localDB';

interface OptimizedImageProps extends ImageProps {
  uri: string;
  thumbnailUri?: string;
  useThumbnailFirst?: boolean;
}

const IMAGE_CACHE_PREFIX = '@image_cache:';

export const OptimizedImage: React.FC<OptimizedImageProps> = ({
  uri,
  thumbnailUri,
  useThumbnailFirst = true,
  style,
  ...props
}) => {
  const [currentUri, setCurrentUri] = useState<string | null>(
    cacheManager.get<string>(uri) || null,
  );
  const [loading, setLoading] = useState(!currentUri);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadImage = async () => {
      if (cacheManager.get(uri)) {
        if (isMounted) {
          setCurrentUri(cacheManager.get<string>(uri) ?? null);
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);
        setError(false);

        // 1. Check persistent cache (simulated)
        const cacheKey = `${IMAGE_CACHE_PREFIX}${uri}`;
        const cachedData = await getItem(cacheKey);

        if (cachedData && isMounted) {
          cacheManager.set(uri, cachedData);
          setCurrentUri(cachedData);
          setLoading(false);
          return;
        }

        // 2. If thumbnail is provided and requested, show it first
        if (useThumbnailFirst && thumbnailUri && isMounted) {
          setCurrentUri(thumbnailUri);
        }

        // 3. Set the main URI and let the Image component handle it
        if (isMounted) {
          cacheManager.set(uri, uri);
          setCurrentUri(uri);
        }
      } catch (err) {
        console.error('Error loading image:', err);
        if (isMounted) setError(true);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadImage();

    return () => {
      isMounted = false;
    };
  }, [uri, thumbnailUri, useThumbnailFirst]);

  if (error) {
    return (
      <View style={[style, styles.placeholder, styles.error]}>
        <View style={styles.errorIcon} />
      </View>
    );
  }

  return (
    <View style={style}>
      {currentUri ? (
        <Image
          {...props}
          source={{ uri: currentUri }}
          style={[style, StyleSheet.absoluteFill]}
          onLoadEnd={() => setLoading(false)}
        />
      ) : null}
      {loading && (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <ActivityIndicator color="#999" />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  error: {
    backgroundColor: '#fee',
  },
  errorIcon: {
    width: 20,
    height: 20,
    backgroundColor: '#f88',
    borderRadius: 10,
  },
});
