import path from 'path';

import express from 'express';
import swaggerUi from 'swagger-ui-express';

const router = express.Router();

// Load the OpenAPI spec from the docs folder

const openApiSpec = require(path.join(__dirname, '../../docs/openapi.json'));

const swaggerOptions: swaggerUi.SwaggerUiOptions = {
  customSiteTitle: 'PetChain API Docs',
  customCss: '.swagger-ui .topbar { background-color: #1a1a2e; }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
  },
};

// Serve Swagger UI at /api/docs
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(openApiSpec, swaggerOptions));

// Serve raw OpenAPI JSON at /api/docs/openapi.json
router.get('/openapi.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openApiSpec);
});

export default router;
