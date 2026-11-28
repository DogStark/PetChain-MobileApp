import React, { useEffect } from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/** Zoom bounds for medical record images (#1399). */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
/** Scale used when double-tapping from 1x. */
export const DOUBLE_TAP_ZOOM = 2;

/** Clamps a scale into the allowed zoom range. */
export function clampZoom(scale: number): number {
  'worklet';
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** Double-tap toggles between 1x and 2x. */
export function nextDoubleTapZoom(current: number): number {
  'worklet';
  return current > MIN_ZOOM ? MIN_ZOOM : DOUBLE_TAP_ZOOM;
}

export interface ZoomableImage {
  uri: string;
  name: string;
}

interface Props {
  visible: boolean;
  images: ZoomableImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/**
 * Full-screen image viewer with pinch-to-zoom (1x–5x), double-tap 1x/2x
 * toggle and pan while zoomed. Zoom resets whenever a different attachment is
 * shown.
 */
export const ZoomableImageViewer: React.FC<Props> = ({
  visible,
  images,
  index,
  onIndexChange,
  onClose,
}) => {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const current = images[index];

  // Reset zoom when navigating to a different attachment (or reopening).
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedX.value = 0;
    savedY.value = 0;
  }, [current?.uri, visible, scale, savedScale, translateX, translateY, savedX, savedY]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clampZoom(savedScale.value * e.scale);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= MIN_ZOOM) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (scale.value <= MIN_ZOOM) return;
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = nextDoubleTapZoom(scale.value);
      scale.value = withTiming(next);
      savedScale.value = next;
      if (next === MIN_ZOOM) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  if (!current) return null;

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {current.name}
            {images.length > 1 ? `  (${index + 1}/${images.length})` : ''}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close zoomed image"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            testID="zoom-viewer-close"
          >
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <GestureDetector gesture={gesture}>
          <Animated.View
            style={[styles.imageWrap, animatedStyle]}
            accessible
            accessibilityLabel={`${current.name}. Pinch to zoom, double tap to zoom in or out.`}
          >
            <Image source={{ uri: current.uri }} style={styles.image} resizeMode="contain" />
          </Animated.View>
        </GestureDetector>

        {images.length > 1 ? (
          <View style={styles.footer}>
            <TouchableOpacity
              onPress={() => onIndexChange(index - 1)}
              disabled={index === 0}
              accessibilityRole="button"
              accessibilityLabel="Previous attachment"
              style={[styles.navButton, index === 0 && styles.navDisabled]}
            >
              <Text style={styles.navText}>‹ Previous</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onIndexChange(index + 1)}
              disabled={index >= images.length - 1}
              accessibilityRole="button"
              accessibilityLabel="Next attachment"
              style={[styles.navButton, index >= images.length - 1 && styles.navDisabled]}
            >
              <Text style={styles.navText}>Next ›</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    zIndex: 1,
  },
  title: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600', marginRight: 12 },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  imageWrap: { flex: 1, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  navButton: { paddingVertical: 10, paddingHorizontal: 16 },
  navDisabled: { opacity: 0.35 },
  navText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

export default ZoomableImageViewer;
