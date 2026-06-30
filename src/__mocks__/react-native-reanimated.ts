/**
 * Mock for react-native-reanimated — lightweight stub for Jest tests.
 */
const Reanimated = {
  useSharedValue: jest.fn((v: any) => ({ value: v })),
  useAnimatedStyle: jest.fn((fn: () => any) => fn()),
  withRepeat: jest.fn((anim: any) => anim),
  withTiming: jest.fn((to: any, _opts?: any) => to),
  interpolate: jest.fn((val: number, input: number[], output: number[]) => {
    const ratio = (val - input[0]) / (input[input.length - 1] - input[0]);
    return output[0] + ratio * (output[output.length - 1] - output[0]);
  }),
  Extrapolate: { CLAMP: 'clamp' },
  View: 'Animated.View',
  default: {
    useSharedValue: jest.fn((v: any) => ({ value: v })),
    useAnimatedStyle: jest.fn((fn: () => any) => fn()),
    withRepeat: jest.fn((anim: any) => anim),
    withTiming: jest.fn((to: any, _opts?: any) => to),
    interpolate: jest.fn((val: number, input: number[], output: number[]) => {
      const ratio = (val - input[0]) / (input[input.length - 1] - input[0]);
      return output[0] + ratio * (output[output.length - 1] - output[0]);
    }),
    Extrapolate: { CLAMP: 'clamp' },
    View: 'Animated.View',
  },
};

module.exports = Reanimated;
