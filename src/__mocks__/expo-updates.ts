export const reloadAsync = jest.fn();
export const checkForUpdateAsync = jest.fn(() => Promise.resolve({ isAvailable: false }));
export const fetchUpdateAsync = jest.fn();

// In the real native module these are static values baked into the running binary at build
// time. Tests should mutate them via __setMockUpdatesState() rather than assigning directly
// to the imported binding (e.g. `Updates.channel = 'x'`), which doesn't work reliably across
// module systems — the setter below updates the same variable these live-export bindings read.
export let channel = 'production';
export let runtimeVersion = 'production-1.0.0';

export function __setMockUpdatesState(overrides: {
  channel?: string;
  runtimeVersion?: string;
}): void {
  if (overrides.channel !== undefined) channel = overrides.channel;
  if (overrides.runtimeVersion !== undefined) runtimeVersion = overrides.runtimeVersion;
}

export function __resetMockUpdatesState(): void {
  channel = 'production';
  runtimeVersion = 'production-1.0.0';
}

export default {
  reloadAsync,
  checkForUpdateAsync,
  fetchUpdateAsync,
  get channel() {
    return channel;
  },
  get runtimeVersion() {
    return runtimeVersion;
  },
};
