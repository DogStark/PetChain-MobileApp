/**
 * useFontScale — dynamic font sizing that honours the system accessibility
 * font-size setting while capping growth at 1.5× to prevent layout breakage.
 *
 * Decision: we cap at 1.5× rather than following the OS without limit because
 * several fixed-height card layouts (medication list, schedule slots) would
 * overflow at the "Accessibility Extra Large" system setting (~2×). Users who
 * require scales beyond 1.5× are best served by zooming at the OS level.
 *
 * Usage:
 *   const fs = useFontScale();
 *   <Text style={{ fontSize: fs(14) }}>Dosage information</Text>
 */

import { useEffect, useState } from 'react';
import { PixelRatio } from 'react-native';

/** Maximum multiplier we allow before clamping. Documented decision: 1.5× */
export const MAX_FONT_SCALE = 1.5;

/**
 * Returns a function that converts a base font size (at scale 1.0) to a
 * scaled font size capped at MAX_FONT_SCALE.
 *
 * Calling the returned function is safe inside StyleSheet.create() only if
 * you rebuild the sheet inside the component (i.e. useMemo/local variable).
 * For static sheets, call `scaledFontSize(base)` at render time on `style`.
 */
export function useFontScale(): (base: number) => number {
  // PixelRatio.getFontScale() is synchronous and reads the current OS value
  const [fontScale, setFontScale] = useState(() =>
    Math.min(PixelRatio.getFontScale(), MAX_FONT_SCALE),
  );

  useEffect(() => {
    // React Native 0.64+ exposes PixelRatio.getFontScale() which updates when
    // the user changes the system font size at runtime. We poll on mount in
    // case the hook mounts after the user has already changed the setting.
    // For live updates the recommended approach is to listen for AppState
    // changes; the value is re-read each time the app returns to foreground.
    const scale = Math.min(PixelRatio.getFontScale(), MAX_FONT_SCALE);
    setFontScale(scale);
  }, []);

  return (base: number) => Math.round(base * fontScale);
}

/**
 * Non-hook version for use outside of React components.
 * Returns the current clamped scale factor.
 */
export function scaledFontSize(base: number): number {
  return Math.round(base * Math.min(PixelRatio.getFontScale(), MAX_FONT_SCALE));
}
