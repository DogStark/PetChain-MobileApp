import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  AccessibilityInfo,
} from 'react-native';

/**
 * Reads the platform "Reduce Motion" accessibility preference.
 * Returns true when the user has requested reduced motion.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = React.useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setReducedMotion(enabled);
        }
      })
      .catch(() => {
        // Preference unavailable; default to full motion.
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        if (mounted) {
          setReducedMotion(enabled);
        }
      },
    );

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return reducedMotion;
}

export interface LoadingStateProps {
  /** Optional label describing what is loading. */
  message?: string;
  /** Size of the loading indicator. */
  size?: 'small' | 'large';
  /** Optional testID for the container. */
  testID?: string;
}

/**
 * Loading feedback that honors the platform reduced-motion preference.
 * When reduced motion is enabled, the pulsing animation is replaced with a
 * static indicator while keeping the loading message understandable.
 */
export function LoadingState({
  message = 'Loading…',
  size = 'large',
  testID,
}: LoadingStateProps) {
  const reducedMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [reducedMotion, pulse]);

  return (
    <View
      style={styles.container}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
    >
      {reducedMotion ? (
        <ActivityIndicator size={size} color={styles.indicator.color} />
      ) : (
        <Animated.View style={{ opacity: pulse }}>
          <ActivityIndicator size={size} color={styles.indicator.color} />
        </Animated.View>
      )}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  indicator: {
    color: '#4A90D9',
  },
  message: {
    marginTop: 12,
    fontSize: 14,
    color: '#555555',
    textAlign: 'center',
  },
});

export default LoadingState;
