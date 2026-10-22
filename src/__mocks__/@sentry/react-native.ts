export const SeverityLevel = {
  fatal: 'fatal',
  error: 'error',
  warning: 'warning',
  info: 'info',
  debug: 'debug',
};

export const mockScope = {
  setExtras: jest.fn(),
  setSpan: jest.fn(),
};

export const mockTransaction = {
  setStatus: jest.fn(),
  finish: jest.fn(),
};

export const init = jest.fn();
export const captureException = jest.fn();
export const captureMessage = jest.fn();
export const withScope = jest.fn((callback) => callback(mockScope));
export const setUser = jest.fn();
export const setContext = jest.fn();
export const addBreadcrumb = jest.fn();
export const startTransaction = jest.fn(() => mockTransaction);
export const startSpan = jest.fn(() => mockTransaction);
export const getCurrentHub = jest.fn(() => ({
  configureScope: jest.fn((callback) => callback(mockScope)),
}));

export default {
  init,
  captureException,
  captureMessage,
  withScope,
  setUser,
  setContext,
  addBreadcrumb,
  startTransaction,
  startSpan,
  getCurrentHub,
  mockScope,
  mockTransaction,
};
