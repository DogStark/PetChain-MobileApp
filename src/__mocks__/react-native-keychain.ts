/**
 * Manual mock for react-native-keychain.
 * Used in Jest (Node) environment where the native module is unavailable.
 */

const store: Record<string, string> = {};

export const ACCESSIBLE = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
} as const;

export const setGenericPassword = jest.fn(
  (_username: string, password: string, options?: { service?: string }): Promise<boolean> => {
    store[options?.service ?? '__default__'] = password;
    return Promise.resolve(true);
  },
);

export const getGenericPassword = jest.fn(
  (options?: { service?: string }): Promise<{ username: string; password: string } | false> => {
    const val = store[options?.service ?? '__default__'];
    return Promise.resolve(val ? { username: 'mock_user', password: val } : false);
  },
);

export const resetGenericPassword = jest.fn((options?: { service?: string }): Promise<boolean> => {
  delete store[options?.service ?? '__default__'];
  return Promise.resolve(true);
});
