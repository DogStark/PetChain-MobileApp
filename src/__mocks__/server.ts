/**
 * MSW Server Setup
 *
 * Configures and exports the Mock Service Worker (MSW) server for use
 * in Node.js-based tests (Jest). The server intercepts fetch/axios requests
 * and returns fixture data defined in `./handlers.ts`.
 *
 * Usage in jest.setup.js:
 *   import { server } from './src/__mocks__/server';
 *   beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
 *   afterEach(() => server.resetHandlers());
 *   afterAll(() => server.close());
 *
 * Override handlers per-test:
 *   server.use(http.post('/api/auth/login', () => HttpResponse.json({}, { status: 401 })));
 *
 * @see https://mswjs.io/docs/integrations/node
 */

import { setupServer } from 'msw/node';

import { handlers } from './handlers';

/**
 * MSW server instance configured with the default API handlers.
 * Exported for use in jest.setup.js and individual test files.
 */
export const server = setupServer(...handlers);
