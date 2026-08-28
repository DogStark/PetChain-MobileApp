/**
 * Jest mock for @stellar/stellar-sdk.
 * Re-exports the real CJS module so Horizon.Server is available as a constructor
 * in the ts-jest (CommonJS) test environment.
 */

const sdk = require('@stellar/stellar-sdk');
module.exports = sdk;
