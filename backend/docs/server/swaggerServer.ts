/**
 * Swagger UI Express server for PetChain API documentation.
 *
 * Serves the interactive API docs at GET /api/docs
 * Serves the raw OpenAPI JSON at GET /api/docs/openapi.json
 *
 * Usage:
 *   npx ts-node backend/docs/server/swaggerServer.ts
 *
 * Or integrate into your existing Express app:
 *   import { mountSwaggerUI } from './backend/docs/server/swaggerServer';
 *   mountSwaggerUI(app);
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';

import { openApiSpec } from '../openapi/spec';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SwaggerServerOptions {
  /** Port to listen on (default: 3001) */
  port?: number;
  /** Base path for the docs UI (default: '/api/docs') */
  docsPath?: string;
  /** Optional API key to protect the docs UI (set via DOCS_API_KEY env var) */
  apiKey?: string;
  /** Whether to enable CORS for the docs server (default: true) */
  enableCors?: boolean;
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

/**
 * Optional lightweight API key guard for the docs endpoint.
 * Set DOCS_API_KEY env var to enable. If not set, docs are public.
 */
function createDocsAuthMiddleware(apiKey?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!apiKey) {
      next();
      return;
    }

    const providedKey = req.headers['x-docs-api-key'] || req.query['api_key'];

    if (providedKey !== apiKey) {
      res.status(401).json({
        success: false,
        error: {
          code: 'DOCS_UNAUTHORIZED',
          message:
            'API key required to access documentation. Provide X-Docs-Api-Key header or ?api_key= query param.',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  };
}

// ─── Swagger UI options ───────────────────────────────────────────────────────

const swaggerUiOptions: swaggerUi.SwaggerUiOptions = {
  customSiteTitle: 'PetChain API Docs',
  customCss: `
    .swagger-ui .topbar { background-color: #1a1a2e; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    .swagger-ui .info .title { color: #4a90d9; }
    .swagger-ui .scheme-container { background: #f8f9fa; padding: 16px; border-radius: 8px; }
  `,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    requestSnippetsEnabled: true,
    requestSnippets: {
      generators: {
        curl_bash: { title: 'cURL (bash)', syntax: 'bash' },
        node_fetch: { title: 'Node.js (fetch)', syntax: 'javascript' },
      },
      defaultExpanded: false,
    },
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
    docExpansion: 'list',
    defaultModelsExpandDepth: 2,
    defaultModelExpandDepth: 2,
  },
};

// ─── Mount function (for integration into existing Express app) ───────────────

/**
 * Mount Swagger UI onto an existing Express application.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { mountSwaggerUI } from './backend/docs/server/swaggerServer';
 *
 * const app = express();
 * mountSwaggerUI(app);
 * app.listen(3000);
 * ```
 */
export function mountSwaggerUI(app: express.Application, options: SwaggerServerOptions = {}): void {
  const { docsPath = '/api/docs', apiKey = process.env.DOCS_API_KEY, enableCors = true } = options;

  const authMiddleware = createDocsAuthMiddleware(apiKey);

  // CORS headers for docs endpoint
  if (enableCors) {
    app.use(docsPath, (_req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, X-Docs-Api-Key',
      );
      next();
    });
  }

  // Serve raw OpenAPI JSON
  app.get(`${docsPath}/openapi.json`, authMiddleware, (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5-minute cache
    res.json(openApiSpec);
  });

  // Serve Swagger UI
  app.use(
    docsPath,
    authMiddleware,
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec as Record<string, unknown>, swaggerUiOptions),
  );

  console.log(`📚 Swagger UI available at ${docsPath}`);
  console.log(`📄 OpenAPI JSON available at ${docsPath}/openapi.json`);
  if (apiKey) {
    console.log(`🔒 Docs protected by API key (X-Docs-Api-Key header)`);
  }
}

// ─── Standalone server ────────────────────────────────────────────────────────

/**
 * Standalone Express server for serving docs independently.
 * Run with: npx ts-node backend/docs/server/swaggerServer.ts
 */
export function createStandaloneDocsServer(
  options: SwaggerServerOptions = {},
): express.Application {
  const app = express();
  const { port = 3001, docsPath = '/api/docs' } = options;

  app.use(express.json());

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Redirect root to docs
  app.get('/', (_req: Request, res: Response) => {
    res.redirect(docsPath);
  });

  mountSwaggerUI(app, options);

  app.listen(port, () => {
    console.log(`\n🚀 PetChain API Docs server running`);
    console.log(`   Swagger UI: http://localhost:${port}${docsPath}`);
    console.log(`   OpenAPI JSON: http://localhost:${port}${docsPath}/openapi.json\n`);
  });

  return app;
}

// ─── Run standalone if executed directly ─────────────────────────────────────

// Check if this file is being run directly (not imported)
if (require.main === module) {
  createStandaloneDocsServer({
    port: Number(process.env.DOCS_PORT) || 3001,
    docsPath: '/api/docs',
    apiKey: process.env.DOCS_API_KEY,
  });
}
