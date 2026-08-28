// Jest setup file for global test configuration
process.env.NODE_ENV = 'test';
// Required for React 18 in Node test environment: tells React's reconciler
// that updates are expected to be wrapped in act(), suppressing spurious
// "not configured to support act()" warnings and making waitFor() reliable.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
process.env.STELLAR_NETWORK = 'testnet';
process.env.JWT_SECRET = 'test-secret-key';

// ─── MSW (Mock Service Worker) ────────────────────────────────────────────────
// Intercepts all outbound HTTP requests in tests and returns realistic fixture
// data via the handlers defined in src/__mocks__/handlers.ts.
//
// MSW is optional/resilient: some environments (or Jest configs that don't
// transform msw's ESM-only transitive deps) cannot load it. When that happens we
// fall back to a no-op server so the remaining (non-network) suites still run.
// eslint-disable-next-line @typescript-eslint/no-require-imports
let server;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  server = require('./src/__mocks__/server').server;
} catch {
  server = { listen: () => undefined, resetHandlers: () => undefined, close: () => undefined };
}

// Start server before all tests; warn on requests with no matching handler
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));

// Reset any per-test handler overrides after each test so they don't leak
afterEach(() => server.resetHandlers());

// Clean up and stop the server after the test suite completes
afterAll(() => server.close());

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

// Use real timers by default for consistent async behavior in tests
jest.useRealTimers();
