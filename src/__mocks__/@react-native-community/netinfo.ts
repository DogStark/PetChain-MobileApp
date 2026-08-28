const listeners: Array<(state: { isConnected: boolean; type: string }) => void> = [];

const mockState = {
  isConnected: true,
  type: 'wifi',
};

const NetInfo = {
  addEventListener: jest.fn((callback: (state: typeof mockState) => void) => {
    listeners.push(callback);
    callback(mockState);
    return jest.fn();
  }),
  fetch: jest.fn(async () => mockState),
  __listeners: listeners,
  __setState(nextState: Partial<typeof mockState>) {
    Object.assign(mockState, nextState);
    listeners.forEach((callback) => callback(mockState));
  },
};

module.exports = NetInfo;
