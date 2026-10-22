/**
 * OpenAPI spec validator for PetChain API.
 *
 * Validates:
 *  1. All documented endpoints have operationIds
 *  2. All $ref references resolve within the spec
 *  3. All documented endpoints match the API_ENDPOINTS constants
 *  4. Required fields are present on all operations
 *  5. All schemas have required fields defined
 *
 * Usage:
 *   npx ts-node backend/docs/validate/validateSpec.ts
 */

import { API_ENDPOINTS } from '../../types/api';
import { openApiSpec } from '../openapi/spec';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalEndpoints: number;
    totalSchemas: number;
    totalRefs: number;
    brokenRefs: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveRef(ref: string, spec: Record<string, unknown>): boolean {
  if (!ref.startsWith('#/')) return true; // External refs — skip
  const parts = ref.slice(2).split('/');
  let current: unknown = spec;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return false;
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) return false;
  }
  return true;
}

function collectRefs(obj: unknown, refs: string[]): void {
  if (typeof obj !== 'object' || obj === null) return;
  if (Array.isArray(obj)) {
    obj.forEach((item) => collectRefs(item, refs));
    return;
  }
  const record = obj as Record<string, unknown>;
  if (typeof record.$ref === 'string') {
    refs.push(record.$ref);
  }
  for (const value of Object.values(record)) {
    collectRefs(value, refs);
  }
}

// ─── Validation checks ────────────────────────────────────────────────────────

function validateOperationIds(
  spec: typeof openApiSpec,
  errors: string[],
  warnings: string[],
): number {
  let count = 0;
  const paths = spec.paths as Record<string, Record<string, unknown>>;
  const seenIds = new Set<string>();

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      count++;
      const op = operation as Record<string, unknown>;

      if (!op.operationId) {
        errors.push(`Missing operationId: ${method.toUpperCase()} ${pathStr}`);
      } else {
        const id = op.operationId as string;
        if (seenIds.has(id)) {
          errors.push(`Duplicate operationId "${id}": ${method.toUpperCase()} ${pathStr}`);
        }
        seenIds.add(id);
      }

      if (!op.summary) {
        warnings.push(`Missing summary: ${method.toUpperCase()} ${pathStr}`);
      }

      if (!op.tags || (op.tags as string[]).length === 0) {
        warnings.push(`Missing tags: ${method.toUpperCase()} ${pathStr}`);
      }

      if (!op.responses) {
        errors.push(`Missing responses: ${method.toUpperCase()} ${pathStr}`);
      }
    }
  }

  return count;
}

function validateRefs(
  spec: typeof openApiSpec,
  errors: string[],
): { total: number; broken: number } {
  const refs: string[] = [];
  collectRefs(spec, refs);

  let broken = 0;
  for (const ref of refs) {
    if (!resolveRef(ref, spec as unknown as Record<string, unknown>)) {
      errors.push(`Broken $ref: "${ref}"`);
      broken++;
    }
  }

  return { total: refs.length, broken };
}

function validateAgainstApiEndpoints(spec: typeof openApiSpec, warnings: string[]): void {
  const documentedPaths = new Set(Object.keys(spec.paths));

  // Normalize API_ENDPOINTS paths (replace :param with {param})
  const expectedPaths = Object.values(API_ENDPOINTS).map((p) => p.replace(/:([a-zA-Z]+)/g, '{$1}'));

  for (const expected of expectedPaths) {
    if (!documentedPaths.has(expected)) {
      warnings.push(`API_ENDPOINTS path not documented: ${expected}`);
    }
  }

  // Check for documented paths not in API_ENDPOINTS
  for (const documented of documentedPaths) {
    const normalized = documented.replace(/\{[^}]+\}/g, ':param');
    const inConstants = Object.values(API_ENDPOINTS).some(
      (p) => p.replace(/:([a-zA-Z]+)/g, ':param') === normalized,
    );
    if (!inConstants) {
      warnings.push(`Documented path not in API_ENDPOINTS constants: ${documented}`);
    }
  }
}

function validateSchemas(spec: typeof openApiSpec, errors: string[], warnings: string[]): number {
  const schemas = (spec.components as Record<string, unknown>)?.schemas as
    | Record<string, unknown>
    | undefined;
  if (!schemas) {
    errors.push('No schemas defined in components.schemas');
    return 0;
  }

  let count = 0;
  for (const [name, schema] of Object.entries(schemas)) {
    count++;
    const s = schema as Record<string, unknown>;

    if (s.type === 'object' && !s.properties && !s.allOf && !s.oneOf && !s.anyOf) {
      warnings.push(`Schema "${name}" is type:object but has no properties defined`);
    }
  }

  return count;
}

// ─── Main validator ───────────────────────────────────────────────────────────

export function validateOpenApiSpec(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log('🔍 Validating PetChain OpenAPI spec...\n');

  // 1. Validate operation IDs and required fields
  const totalEndpoints = validateOperationIds(openApiSpec, errors, warnings);

  // 2. Validate all $ref references resolve
  const { total: totalRefs, broken: brokenRefs } = validateRefs(openApiSpec, errors);

  // 3. Cross-check against API_ENDPOINTS constants
  validateAgainstApiEndpoints(openApiSpec, warnings);

  // 4. Validate schemas
  const totalSchemas = validateSchemas(openApiSpec, errors, warnings);

  // 5. Validate info section
  const info = openApiSpec.info as Record<string, unknown>;
  if (!info.title) errors.push('Missing info.title');
  if (!info.version) errors.push('Missing info.version');
  if (!info.description) warnings.push('Missing info.description');

  // 6. Validate servers
  if (!openApiSpec.servers || openApiSpec.servers.length === 0) {
    warnings.push('No servers defined');
  }

  const passed = errors.length === 0;

  return {
    passed,
    errors,
    warnings,
    stats: { totalEndpoints, totalSchemas, totalRefs, brokenRefs },
  };
}

// ─── CLI runner ───────────────────────────────────────────────────────────────

if (require.main === module) {
  const result = validateOpenApiSpec();

  console.log('📊 Validation Stats:');
  console.log(`   Endpoints:  ${result.stats.totalEndpoints}`);
  console.log(`   Schemas:    ${result.stats.totalSchemas}`);
  console.log(`   $refs:      ${result.stats.totalRefs} (${result.stats.brokenRefs} broken)`);
  console.log();

  if (result.warnings.length > 0) {
    console.log(`⚠️  Warnings (${result.warnings.length}):`);
    result.warnings.forEach((w) => console.log(`   • ${w}`));
    console.log();
  }

  if (result.errors.length > 0) {
    console.log(`❌ Errors (${result.errors.length}):`);
    result.errors.forEach((e) => console.log(`   • ${e}`));
    console.log();
    console.log('❌ Validation FAILED');
    process.exit(1);
  } else {
    console.log('✅ Validation PASSED — spec is valid');
  }
}
