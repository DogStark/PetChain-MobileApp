import { I18nManager, type FlexStyle, type TextStyle } from 'react-native';

import { isRTL } from '../i18n';

/**
 * Direction-aware layout helpers.
 *
 * RTL locales (Arabic) can silently break icons that imply direction, swipe
 * gestures, chart axes and the visual order of form fields. Routing every
 * direction-sensitive decision through these helpers — instead of hard-coding
 * `left` / `right` / `row` — keeps navigation and clinical forms correct in
 * both directions and gives us a single surface to regression-test.
 */

/** Whether the layout is currently right-to-left. */
export function isLayoutRTL(): boolean {
  return I18nManager.isRTL;
}

/** Pick the value that matches the current writing direction. */
export function directionalValue<T>(ltr: T, rtl: T): T {
  return I18nManager.isRTL ? rtl : ltr;
}

/** `flexDirection` for a horizontal strip that should follow reading order. */
export function rowDirection(reverse = false): FlexStyle['flexDirection'] {
  const rtl = reverse ? !I18nManager.isRTL : I18nManager.isRTL;
  return rtl ? 'row-reverse' : 'row';
}

/** Default text alignment for the current direction. */
export function textAlign(align: 'start' | 'end' | 'center' = 'start'): TextStyle['textAlign'] {
  if (align === 'center') return 'center';
  const start = directionalValue<'left' | 'right'>('left', 'right');
  return align === 'start' ? start : start === 'left' ? 'right' : 'left';
}

/**
 * Name of the chevron / arrow that visually points "forward" (deeper into a
 * navigation stack) for the current direction. Back is the mirror of this.
 */
export function forwardChevron(): 'chevron-right' | 'chevron-left' {
  return directionalValue('chevron-right', 'chevron-left');
}

export function backChevron(): 'chevron-right' | 'chevron-left' {
  return directionalValue('chevron-left', 'chevron-right');
}

/**
 * Map a logical edge (`start` / `end`) to a physical one for APIs that do not
 * understand logical props (some chart libs, `Animated` transforms).
 */
export function physicalEdge(edge: 'start' | 'end'): 'left' | 'right' {
  const start = directionalValue<'left' | 'right'>('left', 'right');
  return edge === 'start' ? start : start === 'left' ? 'right' : 'left';
}

/** Sign to apply to a horizontal translate/swipe delta so "forward" is consistent. */
export function directionalSign(): 1 | -1 {
  return I18nManager.isRTL ? -1 : 1;
}

/**
 * Resolve the direction for an explicit language code (independent of the
 * global `I18nManager` state) — used by screenshot tests that render a specific
 * locale without reloading the app.
 */
export function directionForLanguage(lang: string): 'ltr' | 'rtl' {
  return isRTL(lang) ? 'rtl' : 'ltr';
}

export default {
  isLayoutRTL,
  directionalValue,
  rowDirection,
  textAlign,
  forwardChevron,
  backChevron,
  physicalEdge,
  directionalSign,
  directionForLanguage,
};
