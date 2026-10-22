/* eslint-disable @typescript-eslint/no-require-imports */
const baseConfig = require('./jest.config.js');

module.exports = {
  ...baseConfig,
  testMatch: ['**/tests/integration/__tests__/**/*.integration.test.ts'],
  moduleNameMapper: Object.fromEntries(
    Object.entries(baseConfig.moduleNameMapper).filter(([key]) => key !== '^pg$'),
  ),
  setupFilesAfterEnv: ['<rootDir>/jest.integration.setup.js'],
  testTimeout: 30000,
};
