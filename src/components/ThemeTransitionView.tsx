import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { darkTheme, lightTheme } from '../theme/colors';
import { useTheme } from '../utils/useTheme';

const TRANSITION_MS = 260;

const ThemeTransitionView: React.FC<React.PropsWithChildren<unknown>> = ({ children }) => {
  const { theme } = useTheme();
  const progress = useSharedValue(theme === 'dark' ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(theme === 'dark' ? 1 : 0, { duration: TRANSITION_MS });
  }, [progress, theme]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [lightTheme.background, darkTheme.background],
    ),
  }));

  return <Animated.View style={[styles.root, animatedStyle]}>{children}</Animated.View>;
};

const styles = StyleSheet.create({
  root: { flex: 1 },
});

export default ThemeTransitionView;
