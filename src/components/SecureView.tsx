import React from 'react';
import { View, type ViewProps } from 'react-native';

import { useSecureScreen } from '../utils/secureScreen';

/**
 * Drop-in View replacement that blocks screenshots and screen recording.
 * Wrap any sensitive screen's root element with this component.
 */
const SecureView: React.FC<ViewProps> = ({ children, style, ...props }) => {
  useSecureScreen();
  return (
    <View style={style} {...props}>
      {children}
    </View>
  );
};

export default SecureView;
