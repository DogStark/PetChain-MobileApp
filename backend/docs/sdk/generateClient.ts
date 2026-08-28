/**
 * TypeScript client SDK generator for the PetChain API.
 *
 * Generates a fully-typed Axios-based client from the OpenAPI spec.
 *
 * Usage:
 *   npx ts-node backend/docs/sdk/generateClient.ts
 *
 * Output: backend/docs/sdk/generated/petchain-client.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EndpointDef {
  method: string;
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  hasBody: boolean;
  hasPathParams: boolean;
  hasQueryParams: boolean;
  security: boolean;
}

// ─── Extract endpoints from spec ─────────────────────────────────────────────

function extractEndpoints(spec: Record<string, unknown>): EndpointDef[] {
  const endpoints: EndpointDef[] = [];
  const paths = spec.paths as Record<string, Record<string, unknown>>;

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;

      const op = operation as Record<string, unknown>;
      const params = (op.parameters as Array<Record<string, unknown>>) || [];

      endpoints.push({
        method: method.toUpperCase(),
        path: pathStr,
        operationId:
          (op.operationId as string) || `${method}_${pathStr.replace(/[^a-zA-Z0-9]/g, '_')}`,
        summary: (op.summary as string) || '',
        tags: (op.tags as string[]) || [],
        hasBody: !!op.requestBody,
        hasPathParams: params.some((p) => p.in === 'path'),
        hasQueryParams: params.some((p) => p.in === 'query'),
        security: Array.isArray(op.security) ? op.security.length > 0 : !!spec.security,
      });
    }
  }

  return endpoints;
}

// ─── Generate method signature ────────────────────────────────────────────────

function generateMethod(endpoint: EndpointDef): string {
  const {
    method,
    path: pathStr,
    operationId,
    summary,
    hasBody,
    hasPathParams,
    hasQueryParams,
  } = endpoint;

  // Build parameter list
  const params: string[] = [];
  if (hasPathParams) {
    // Extract path param names
    const pathParams = (pathStr.match(/\{([^}]+)\}/g) || []).map((p) => p.slice(1, -1));
    for (const param of pathParams) {
      params.push(`${param}: string`);
    }
  }
  if (hasBody) {
    params.push('body: Record<string, unknown>');
  }
  if (hasQueryParams) {
    params.push('params?: Record<string, unknown>');
  }

  // Build URL with path param substitution
  const urlExpr = pathStr.replace(
    /\{([^}]+)\}/g,
    (_match, param) => `\${encodeURIComponent(${param})}`,
  );

  // Build axios call
  const axiosArgs: string[] = [`\`${urlExpr}\``];
  if (hasBody) axiosArgs.push('body');
  if (hasQueryParams) axiosArgs.push('{ params }');

  const axiosMethod = method.toLowerCase();
  let axiosCall: string;
  if (method === 'GET' || method === 'DELETE') {
    axiosCall = hasQueryParams
      ? `this.client.${axiosMethod}(\`${urlExpr}\`, { params })`
      : `this.client.${axiosMethod}(\`${urlExpr}\`)`;
  } else {
    axiosCall = hasQueryParams
      ? `this.client.${axiosMethod}(\`${urlExpr}\`, body, { params })`
      : `this.client.${axiosMethod}(\`${urlExpr}\`, ${hasBody ? 'body' : 'undefined'})`;
  }

  return `
  /**
   * ${summary}
   * ${method} ${pathStr}
   */
  async ${operationId}(${params.join(', ')}): Promise<AxiosResponse> {
    return ${axiosCall};
  }`;
}

// ─── Generate full SDK file ───────────────────────────────────────────────────

function generateSdkFile(endpoints: EndpointDef[]): string {
  const methods = endpoints.map(generateMethod).join('\n');

  return `/**
 * PetChain API — TypeScript Client SDK
 *
 * Auto-generated from OpenAPI spec. Do not edit manually.
 * Regenerate with: npx ts-node backend/docs/sdk/generateClient.ts
 *
 * Generated: ${new Date().toISOString()}
 */

import axios, { type AxiosInstance, type AxiosResponse, type AxiosRequestConfig } from 'axios';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface PetChainClientConfig {
  /** API base URL (default: https://api.petchain.app/api) */
  baseUrl?: string;
  /** JWT access token for authenticated requests */
  token?: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
  /** Custom Axios config to merge */
  axiosConfig?: AxiosRequestConfig;
}

// ─── Client class ─────────────────────────────────────────────────────────────

export class PetChainClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor(config: PetChainClientConfig = {}) {
    const {
      baseUrl = 'https://api.petchain.app/api',
      token,
      timeoutMs = 10000,
      axiosConfig = {},
    } = config;

    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...axiosConfig,
    });

    if (token) {
      this.setToken(token);
    }

    // Request interceptor — inject auth token
    this.client.interceptors.request.use((requestConfig) => {
      if (this.token) {
        requestConfig.headers = requestConfig.headers ?? {};
        requestConfig.headers.Authorization = \`Bearer \${this.token}\`;
      }
      return requestConfig;
    });

    // Response interceptor — normalize errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const data = error.response?.data as { error?: { message?: string; code?: string } } | undefined;
          const message = data?.error?.message || error.message;
          const code = data?.error?.code || \`HTTP_\${status}\`;
          throw new PetChainApiError(message, code, status);
        }
        throw error;
      },
    );
  }

  /** Set or update the JWT access token */
  setToken(token: string): void {
    this.token = token;
  }

  /** Clear the stored token (e.g. on logout) */
  clearToken(): void {
    this.token = null;
  }

  // ─── Generated methods ─────────────────────────────────────────────────────
${methods}
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class PetChainApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PetChainApiError';
  }
}

// ─── Factory function ─────────────────────────────────────────────────────────

/**
 * Create a pre-configured PetChain API client.
 *
 * @example
 * \`\`\`ts
 * const client = createPetChainClient({ token: 'your-jwt-token' });
 * const pets = await client.listPets();
 * \`\`\`
 */
export function createPetChainClient(config?: PetChainClientConfig): PetChainClient {
  return new PetChainClient(config);
}

export default PetChainClient;
`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🔧 Generating PetChain TypeScript client SDK...');

  // Dynamically import the spec (avoids circular dep issues at generation time)
  const { openApiSpec } = await import('../openapi/spec');

  const endpoints = extractEndpoints(openApiSpec as unknown as Record<string, unknown>);
  console.log(
    `   Found ${endpoints.length} endpoints across ${new Set(endpoints.map((e) => e.tags[0])).size} tags`,
  );

  const sdkContent = generateSdkFile(endpoints);

  const outputDir = path.join(__dirname, 'generated');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'petchain-client.ts');
  fs.writeFileSync(outputPath, sdkContent, 'utf-8');

  console.log(`✅ SDK generated: ${outputPath}`);
  console.log(`   ${endpoints.length} methods generated`);

  // Also write the OpenAPI spec as JSON for tooling
  const specJsonPath = path.join(outputDir, 'openapi.json');
  fs.writeFileSync(specJsonPath, JSON.stringify(openApiSpec, null, 2), 'utf-8');
  console.log(`✅ OpenAPI JSON written: ${specJsonPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ SDK generation failed:', err);
    process.exit(1);
  });
}
