import { useEffect, useState } from 'react';
import { Dimensions, PixelRatio, Platform, type ScaledSize } from 'react-native';

/** Reference design dimensions (iPhone 14 Pro) */
const BASE_WIDTH = 393;
const BASE_HEIGHT = 852;

export type DeviceType = 'phone' | 'tablet' | 'desktop';
export type Orientation = 'portrait' | 'landscape';

function getDeviceType(window: ScaledSize): DeviceType {
  const shortSide = Math.min(window.width, window.height);
  if (shortSide >= 768) return 'tablet';
  if (shortSide >= 1024) return 'desktop';
  return 'phone';
}

function getOrientation(window: ScaledSize): Orientation {
  return window.width > window.height ? 'landscape' : 'portrait';
}

// ─────────────────────────────────────────────────────────────
// SCALE HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Scale a size value proportionally to the screen width.
 * Best for widths, paddings, margins.
 */
export function scale(size: number): number {
  const { width } = Dimensions.get('window');
  return (width / BASE_WIDTH) * size;
}

/**
 * Scale a size value proportionally to the screen height.
 * Best for heights, vertical spacing.
 */
export function verticalScale(size: number): number {
  const { height } = Dimensions.get('window');
  return (height / BASE_HEIGHT) * size;
}

/**
 * Moderate scale — blends fixed and proportional scaling.
 * @param factor  - how much of the scaling to apply (0 = fixed, 1 = full scale)
 */
export function moderateScale(size: number, factor = 0.5): number {
  return size + (scale(size) - size) * factor;
}

/**
 * Normalize a font size for different pixel densities.
 */
export function normalizeFontSize(size: number): number {
  const newSize = scale(size);
  if (Platform.OS === 'ios') {
    return Math.round(PixelRatio.roundToNearestPixel(newSize));
  }
  return Math.round(PixelRatio.roundToNearestPixel(newSize)) - 2;
}

// ─────────────────────────────────────────────────────────────
// BREAKPOINTS
// ─────────────────────────────────────────────────────────────

export interface BreakpointValues<T> {
  phone: T;
  tablet: T;
  desktop?: T;
}

/**
 * Pick a value based on the current device type.
 *
 * @example
 * const columns = breakpoint({ phone: 1, tablet: 2, desktop: 3 });
 */
export function breakpoint<T>(values: BreakpointValues<T>): T {
  const window = Dimensions.get('window');
  const type = getDeviceType(window);
  if (type === 'desktop' && values.desktop !== undefined) return values.desktop;
  if (type === 'tablet') return values.tablet;
  return values.phone;
}

// ─────────────────────────────────────────────────────────────
// HOOK — useResponsive
// ─────────────────────────────────────────────────────────────

export interface ResponsiveInfo {
  width: number;
  height: number;
  deviceType: DeviceType;
  orientation: Orientation;
  isTablet: boolean;
  isLandscape: boolean;
  scale: (size: number) => number;
  verticalScale: (size: number) => number;
  moderateScale: (size: number, factor?: number) => number;
  normalizeFontSize: (size: number) => number;
}

/**
 * React hook that returns responsive utilities and re-renders on
 * orientation or dimension change.
 *
 * @example
 * const { isTablet, isLandscape, scale } = useResponsive();
 */
export function useResponsive(): ResponsiveInfo {
  const [dimensions, setDimensions] = useState(() => Dimensions.get('window'));

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDimensions(window);
    });
    return () => subscription.remove();
  }, []);

  const deviceType = getDeviceType(dimensions);
  const orientation = getOrientation(dimensions);

  return {
    width: dimensions.width,
    height: dimensions.height,
    deviceType,
    orientation,
    isTablet: deviceType === 'tablet' || deviceType === 'desktop',
    isLandscape: orientation === 'landscape',
    scale,
    verticalScale,
    moderateScale,
    normalizeFontSize,
  };
}

// ─────────────────────────────────────────────────────────────
// GRID
// ─────────────────────────────────────────────────────────────

/**
 * Calculate column count for a grid based on device type.
 *
 * @example
 * const numColumns = gridColumns({ phone: 2, tablet: 3 });
 */
export const gridColumns = (values: BreakpointValues<number>): number => breakpoint(values);

/**
 * Calculate item width for a grid with configurable columns and gutter.
 */
export function gridItemWidth(columns: number, gutter = 16, containerPadding = 16): number {
  const { width } = Dimensions.get('window');
  const available = width - containerPadding * 2 - gutter * (columns - 1);
  return available / columns;
}
