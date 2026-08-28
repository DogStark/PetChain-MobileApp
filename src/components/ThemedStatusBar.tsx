import React from 'react';
import { StatusBar } from 'react-native';

import { darkTheme, lightTheme } from '../theme/colors';
import { useTheme } from '../utils/useTheme';

const ThemedStatusBar: React.FC = () => {
  const { theme } = useTheme();
  return (
    <StatusBar
      barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
      backgroundColor={theme === 'dark' ? darkTheme.surface : lightTheme.background}
    />
  );
};

export default ThemedStatusBar;
