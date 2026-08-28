/**
 * PetChain API Documentation — Public exports
 *
 * This module is the single entry point for all documentation tooling.
 *
 * @example Integration into an existing Express app:
 * ```ts
 * import express from 'express';
 * import { mountSwaggerUI, openApiSpec } from './backend/docs';
 *
 * const app = express();
 * mountSwaggerUI(app);
 * app.listen(3000);
 * ```
 */

export { openApiSpec } from './openapi/spec';
export { mountSwaggerUI, createStandaloneDocsServer } from './server/swaggerServer';
export { validateOpenApiSpec } from './validate/validateSpec';
