import { AccessibilityInfo } from 'react-native';
import { useEffect, useState } from 'react';
import { darkTheme, lightTheme, navigationDarkTheme, navigationLightTheme } from './colors';
import { tokens } from './tokens';
import { useTheme as useThemePreference } from '../context/ThemeContext';

/**
 * Hook to retrieve the current application colors, ensuring WCAG AA
 * contrast compliance for all standard and secondary/tertiary colors.
 */
export function useAppTheme() {
  const { colors } = useThemePreference();
  return colors;
}

/**
 * Hook to retrieve the navigation theme configuration aligned with
 * accessibility and contrast standards.
 */
export function useNavigationTheme() {
  const { theme } = useThemePreference();
  return theme === 'dark' ? navigationDarkTheme : navigationLightTheme;
}

/**
 * Hook that reads the platform "Reduce Motion" accessibility preference.
 * Returns true when the user has requested reduced motion so that
 * transitions, loaders, and chart effects can fall back to static or
 * low-motion variants.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let isMounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (isMounted) {
        setReducedMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        setReducedMotion(enabled);
      },
    );

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

/**
 * Shared animation configuration routed through the theme layer.
 * When reduced motion is enabled, durations collapse to 0 and spring
 * effects are disabled so navigation, modal, and feedback animations
 * become effectively static while remaining understandable.
 */
export function useMotionConfig() {
  const reducedMotion = useReducedMotion();

  return {
    reducedMotion,
    duration: reducedMotion ? 0 : tokens.motion?.duration ?? 250,
    spring: reducedMotion ? { tension: 0, friction: 0 } : tokens.motion?.spring,
  };
}

export { tokens, lightTheme, darkTheme, navigationLightTheme, navigationDarkTheme };
export { contrastRatio, passesWcagAA } from './contrast';
