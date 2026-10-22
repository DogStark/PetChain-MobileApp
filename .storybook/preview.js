import React from 'react';
import { View, useColorScheme } from 'react-native';

import { darkTheme, lightTheme } from '../src/theme/colors';
import { ThemeProvider } from '../src/utils/useTheme';

/** @type { import('@storybook/react-native').Preview } */
const preview = {
  parameters: {
    actions: { argTypesRegex: '^on.*' },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'gray', value: '#f5f5f5' },
        { name: 'dark', value: '#0f172a' },
      ],
    },
    controls: { expanded: true },
    notes: 'Storybook renders components with theme-aware backgrounds and accessible annotations.',
  },
  decorators: [
    (Story) => {
      const colorScheme = useColorScheme();
      const backgroundColor = colorScheme === 'dark' ? darkTheme.background : lightTheme.background;
      return (
        <ThemeProvider>
          <View style={{ flex: 1, minHeight: '100%', backgroundColor, padding: 16 }}>
            <Story />
          </View>
        </ThemeProvider>
      );
    },
  ],
};

export default preview;
