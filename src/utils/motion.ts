/**
 * motion.ts
 *
 * Reduced-motion helpers (WCAG 2.3.3 Animation from Interactions).
 *
 * When the OS "Reduce Motion" switch is on we must not remove the state change,
 * only the movement: transitions become instant, looping/parallax/gesture-driven
 * animations are disabled, and charts draw their final frame directly. These
 * helpers are pure so the policy can be unit tested; the live OS preference is
 * read by `useReducedMotion`.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Duration to use for a transition given the current preference. */
export function motionDuration(baseMs: number, reduceMotion: boolean): number {
  return reduceMotion ? 0 : baseMs;
}

/**
 * React Navigation / Reanimated style option resolver. Returns config that keeps
 * the end state but skips the movement when reduce motion is on.
 */
export function resolveTransition(
  baseMs: number,
  reduceMotion: boolean,
): { duration: number; useNativeDriver: true; animationEnabled: boolean } {
  return {
    duration: motionDuration(baseMs, reduceMotion),
    useNativeDriver: true,
    animationEnabled: !reduceMotion,
  };
}

/** Whether a decorative / looping animation (spinner pulse, parallax) may run. */
export function allowDecorativeAnimation(reduceMotion: boolean): boolean {
  return !reduceMotion;
}

/**
 * Progress value a chart's draw animation should report. With reduce motion the
 * chart jumps straight to fully drawn (1) instead of easing from 0.
 */
export function chartDrawProgress(reduceMotion: boolean): 0 | 1 {
  return reduceMotion ? 1 : 0;
}

type Cleanup = () => void;

/**
 * Live OS "Reduce Motion" preference. Defaults to `false`, updates on the
 * `reduceMotionChanged` event, and cleans up its listener on unmount.
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => {
        if (mounted) setReduceMotion(!!enabled);
      })
      .catch(() => {
        /* preference unavailable — keep motion enabled */
      });

    const sub = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (enabled: boolean) => setReduceMotion(!!enabled),
    );

    return () => {
      mounted = false;
      (sub as unknown as { remove?: () => void } | undefined)?.remove?.();
    };
  }, []);

  return reduceMotion;
}

export type { Cleanup };
