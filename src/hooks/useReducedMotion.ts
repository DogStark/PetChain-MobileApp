import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Reads the platform "Reduce Motion" accessibility preference.
 *
 * Returns `true` when the user has enabled Reduce Motion, `false` otherwise.
 * The value is kept in sync with the system setting while the component is
 * mounted, so toggling the preference in OS accessibility settings is
 * reflected without a reload.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (isMounted) {
          setReducedMotion(enabled);
        }
      })
      .catch(() => {
        // If the platform cannot report the preference, default to full motion.
        if (isMounted) {
          setReducedMotion(false);
        }
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        if (isMounted) {
          setReducedMotion(enabled);
        }
      },
    );

    return () => {
      isMounted = false;
      subscription?.remove?.();
    };
  }, []);

  return reducedMotion;
}

export default useReducedMotion;
