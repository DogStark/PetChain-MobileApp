/* eslint-env jest */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.STELLAR_NETWORK = 'testnet';
process.env.RUN_INTEGRATION_TESTS = 'true';

// eslint-disable-next-line no-undef -- Jest global provided by test runner
jest.useRealTimers();
