// Manual mock for react-native to allow Jest (node environment) to run without a native runtime.
export const Platform = {
  OS: 'android',
  select: (obj: Record<string, unknown>) => obj['android'] ?? obj['default'],
};

export const Dimensions = {
  get: (_dim: string) => ({ width: 375, height: 812 }),
};

export const PixelRatio = {
  getFontScale: () => 1,
  roundToNearestPixel: (size: number) => Math.round(size),
};

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (style: unknown) => style,
  hairlineWidth: 1,
};

export const Alert = {
  alert: jest.fn(),
};

export const Animated = {
  Value: jest.fn(() => ({ interpolate: jest.fn(), setValue: jest.fn() })),
  View: 'Animated.View',
  timing: jest.fn(() => ({ start: jest.fn() })),
  spring: jest.fn(() => ({ start: jest.fn() })),
  parallel: jest.fn(() => ({ start: jest.fn() })),
  sequence: jest.fn(() => ({ start: jest.fn() })),
};

export const TouchableOpacity = 'TouchableOpacity';
export const TouchableHighlight = 'TouchableHighlight';
export const TouchableWithoutFeedback = 'TouchableWithoutFeedback';
export const View = 'View';
export const Text = 'Text';
export const TextInput = 'TextInput';
export const ScrollView = 'ScrollView';
export const FlatList = 'FlatList';
export const SectionList = 'SectionList';
export const Image = 'Image';
export const SafeAreaView = 'SafeAreaView';
export const KeyboardAvoidingView = 'KeyboardAvoidingView';
export const Switch = 'Switch';
export const ActivityIndicator = 'ActivityIndicator';
export const Modal = 'Modal';
export const StatusBar = { setBarStyle: jest.fn(), setBackgroundColor: jest.fn() };

export const Linking = {
  openURL: jest.fn(),
  canOpenURL: jest.fn(() => Promise.resolve(true)),
};

export const AppState = {
  currentState: 'active',
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
};
