# Testing Guide

This document explains how to write, run, and structure tests in this project, and the mocking patterns used.

## Test Types & Config

| Type | Config | Notes |
|---|---|---|
| Unit / component tests | `jest.config.js` | Default `npm test` — runs `**/__tests__/**/*.test.ts(x)` |
| Integration tests | `jest.integration.config.js`, `jest.integration.setup.js` | Broader tests exercising multiple modules/services together |
| E2E tests | `e2e/`, `.detoxrc.js` | Detox-based device/simulator tests |
| Maestro flows | `.maestro/flows`, `.maestro/scripts` | Scripted UI flow tests |

Setup files: `jest.setup.js` (unit) and `jest.integration.setup.js` (integration) configure global test environment behavior (e.g. polyfills, global mocks) before tests run.

## Directory Structure

- `src/__tests__/` — unit tests for app source (services, utils, components, hooks) colocated near what they test by feature.
- `tests/__tests__/` — additional top-level test suites (e.g. migration runners).
- `scripts/__tests__/` — tests for build/dev scripts.
- `backend/__tests__/`, `backend/tests/` — backend unit/integration tests.
- `src/__mocks__/` — manual mocks for native modules and third-party packages (see below).
- `e2e/` — Detox end-to-end test specs.

Name test files `*.test.ts` / `*.test.tsx` so Jest's `testMatch` picks them up.

## Running Tests

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration   # (check package.json for exact script name)

# E2E (Detox)
npm run e2e:test           # (check package.json / .detoxrc.js for exact script name)
```

Always check `package.json` scripts for the exact current command names before running, as these may be renamed over time.

## Mocking Patterns

Jest's `moduleNameMapper` in `jest.config.js` redirects native/third-party modules to hand-written mocks in `src/__mocks__/`, e.g.:

- `react-native`, `react-native-keychain`, `react-native-image-picker`, `@react-native-community/netinfo` → RN-specific mocks
- `expo-*` modules (constants, crypto, sqlite, notifications, secure-store, etc.) → Expo API mocks
- `pg`, `archiver`, `sharp`, `multer`, `socket.io`, `socket.io-client`, `@elastic/elasticsearch`, `node-fetch` → backend/native dependency mocks
- `@sentry/react-native` → no-op error tracking mock
- `otplib`, `react-i18next` → behavior-preserving lightweight mocks

**When to add a new manual mock:**

1. If a test fails because a native module or third-party package can't run in the Jest (Node) environment, add a mock file under `src/__mocks__/` mirroring the package's public API surface (only what's used).
2. Register it in `moduleNameMapper` in `jest.config.js` (and `jest.integration.config.js` if used there too).
3. Keep mocks minimal — implement only the functions/exports actually exercised by tests.

**Mocking services/modules per-test:**

Use standard Jest mocking for anything not globally mapped:

```ts
jest.mock('../../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));
```

Prefer mocking at the service boundary (e.g. mock `apiClient` or a specific service function) rather than mocking deep internals, so tests remain resilient to refactors.

## Writing Tests

- Structure tests with `describe`/`it` blocks grouped by function or behavior.
- Prefer testing service functions and hooks in isolation from UI rendering where possible; use component tests only for behavior that depends on rendering.
- For async service calls, mock the underlying `apiClient`/HTTP layer rather than hitting real network calls.
- Keep fixtures/test data close to the test file unless shared across many tests, in which case place them in a `__fixtures__` or similar folder near usage.

## Contributing

When adding a new service or module:

1. Add a corresponding test file under the matching `__tests__` directory.
2. Add any new native/third-party dependency mocks under `src/__mocks__/` and wire them into `jest.config.js`.
3. Run the relevant test suite locally before opening a PR (see the PR template's testing checklist).
