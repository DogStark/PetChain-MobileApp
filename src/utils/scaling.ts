import { Dimensions, PixelRatio } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Based on a standard 375pt width screen (iPhone X/11/12/13/14)
const baseWidth = 375;

/**
 * Scales a size based on the screen width.
 */
export const scale = (size: number) => {
  const newSize = (SCREEN_WIDTH / baseWidth) * size;
  return Math.round(PixelRatio.roundToNearestPixel(newSize));
};

/**
 * Scales a font size based on the screen width and font scale factor.
 */
export const scaleFont = (size: number) => {
  const fontScale = PixelRatio.getFontScale();
  return scale(size) * fontScale;
};

/**
 * Scales a font size, allowing for an optional additional multiplier.
 */
export const moderateScale = (size: number, factor = 0.5) => {
  return size + (scale(size) - size) * factor;
};
