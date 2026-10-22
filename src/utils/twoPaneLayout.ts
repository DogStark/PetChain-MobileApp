import { Dimensions, type ScaledSize } from 'react-native';

import { useResponsive } from './responsive';

/**
 * Two-pane (master/detail) layout helpers for tablets and foldables.
 *
 * Fixed phone layouts waste horizontal space on large screens and break when
 * the window is resized (split-screen, foldable unfold, orientation change).
 * These helpers derive a stable layout decision from the *current* window size
 * so screens can render a single scrolling column on a phone and a
 * list + detail split on anything wider, re-flowing live as the window changes.
 */

/** Minimum window width (dp) at which a side-by-side split is worthwhile. */
export const TWO_PANE_MIN_WIDTH = 720;

/** Preferred width (dp) of the master/list pane; the detail pane takes the rest. */
export const MASTER_PANE_WIDTH = 340;

/** The master pane never shrinks below this or grows past this fraction. */
const MASTER_MIN_WIDTH = 280;
const MASTER_MAX_FRACTION = 0.42;

export interface TwoPaneLayout {
  /** Render both panes at once. */
  isTwoPane: boolean;
  /** Width (dp) for the master/list pane. 0 when single-pane. */
  masterWidth: number;
  /** Width (dp) for the detail pane. Full width when single-pane. */
  detailWidth: number;
  /**
   * Navigation hint: in single-pane mode the detail screen is a separate route
   * that is pushed; in two-pane mode selecting a list row just swaps the detail
   * pane content in place.
   */
  detailPresentation: 'push' | 'inline';
  windowWidth: number;
  windowHeight: number;
}

export function computeTwoPaneLayout(window: Pick<ScaledSize, 'width' | 'height'>): TwoPaneLayout {
  const { width, height } = window;
  const isTwoPane = width >= TWO_PANE_MIN_WIDTH;

  if (!isTwoPane) {
    return {
      isTwoPane: false,
      masterWidth: 0,
      detailWidth: width,
      detailPresentation: 'push',
      windowWidth: width,
      windowHeight: height,
    };
  }

  const masterWidth = Math.round(
    Math.min(Math.max(MASTER_PANE_WIDTH, MASTER_MIN_WIDTH), width * MASTER_MAX_FRACTION),
  );

  return {
    isTwoPane: true,
    masterWidth,
    detailWidth: width - masterWidth,
    detailPresentation: 'inline',
    windowWidth: width,
    windowHeight: height,
  };
}

/**
 * Hook variant — re-computes on every orientation / dimension / split-screen
 * change because it is built on {@link useResponsive}, which subscribes to
 * `Dimensions` change events.
 */
export function useTwoPaneLayout(): TwoPaneLayout {
  const { width, height } = useResponsive();
  return computeTwoPaneLayout({ width, height });
}

/** Non-hook accessor for use outside React (navigators, selectors). */
export function getTwoPaneLayout(): TwoPaneLayout {
  return computeTwoPaneLayout(Dimensions.get('window'));
}

export default {
  TWO_PANE_MIN_WIDTH,
  MASTER_PANE_WIDTH,
  computeTwoPaneLayout,
  useTwoPaneLayout,
  getTwoPaneLayout,
};
