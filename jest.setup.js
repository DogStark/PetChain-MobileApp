// Jest setup file for global test configuration
process.env.NODE_ENV = 'test';
// Required for React 18 in Node test environment: tells React's reconciler
// that updates are expected to be wrapped in act(), suppressing spurious
// "not configured to support act()" warnings and making waitFor() reliable.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
process.env.STELLAR_NETWORK = 'testnet';
process.env.JWT_SECRET = 'test-secret-key';

// Suppress console errors in tests unless explicitly needed
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Warning: ReactDOM.render') ||
        args[0].includes('Not implemented: HTMLFormElement.prototype.submit'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});

// Mock timers for consistent testing
jest.useFakeTimers();
