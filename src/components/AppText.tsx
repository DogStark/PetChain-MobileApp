import React from 'react';
import { Text, type TextProps, StyleSheet } from 'react-native';

import { scaleFont } from '../utils/scaling';

interface AppTextProps extends TextProps {
  /**
   * Optional font size. If not provided, it will use the style's font size.
   */
  size?: number;
}

const AppText: React.FC<AppTextProps> = ({ children, style, size, ...props }) => {
  const flattenedStyle = StyleSheet.flatten(style);
  const originalFontSize = size ?? (flattenedStyle?.fontSize as number) ?? 14;

  const scaledFontSize = scaleFont(originalFontSize);

  return (
    <Text
      {...props}
      style={[flattenedStyle, { fontSize: scaledFontSize }]}
      maxFontSizeMultiplier={1.5} // Allow up to 50% larger than scaled
    >
      {children}
    </Text>
  );
};

export default AppText;
