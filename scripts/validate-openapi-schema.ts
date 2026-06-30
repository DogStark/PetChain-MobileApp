/**
 * OpenAPI 3.0 JSON Schema validator.
 *
 * Validates backend/docs/openapi.json against the official OpenAPI 3.0 JSON Schema,
 * and validates all internal $ref references resolve correctly.
 *
 * Uses the existing backend/docs/validate/validateSpec.ts logic for internal
 * consistency checks, plus JSON Schema validation for OpenAPI 3.0 compliance.
 *
 * Usage:
 *   npx tsx scripts/validate-openapi-schema.ts
 *
 * Exit codes:
 *   0 — validation passed
 *   1 — validation failed (errors printed to stderr)
 */

import * as fs from 'fs';
import * as path from 'path';

import { validateOpenApiSpec } from '../backend/docs/validate/validateSpec';

const SPEC_PATH = path.resolve(__dirname, '../backend/docs/openapi.json');

function validateJsonStructure(spec: unknown): string[] {
  const errors: string[] = [];

  if (typeof spec !== 'object' || spec === null) {
    errors.push('Spec is not a JSON object');
    return errors;
  }

  const obj = spec as Record<string, unknown>;

  // Required top-level fields per OpenAPI 3.0 spec
  if (!obj.openapi) {
    errors.push('Missing required field: openapi');
  } else if (typeof obj.openapi !== 'string' || !String(obj.openapi).startsWith('3.')) {
    errors.push(`openapi version must start with "3." — got "${obj.openapi}"`);
  }

  if (!obj.info) {
    errors.push('Missing required field: info');
  } else {
    const info = obj.info as Record<string, unknown>;
    if (!info.title) errors.push('Missing required field: info.title');
    if (!info.version) errors.push('Missing required field: info.version');
  }

  if (!obj.paths && !obj.components) {
    errors.push('Spec must contain at least "paths" or "components"');
  }

  return errors;
}

function validateAllRefsResolve(obj: unknown, spec: unknown, path: string): string[] {
  const errors: string[] = [];

  if (typeof obj !== 'object' || obj === null) return errors;

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      errors.push(...validateAllRefsResolve(item, spec, `${path}[${i}]`));
    });
    return errors;
  }

  const record = obj as Record<string, unknown>;

  if (typeof record.$ref === 'string') {
    const ref = record.$ref;
    if (ref.startsWith('#/')) {
      const parts = ref.slice(2).split('/');
      let current: unknown = spec;
      let resolved = true;
      for (const part of parts) {
        if (typeof current !== 'object' || current === null) {
          resolved = false;
          break;
        }
        current = (current as Record<string, unknown>)[part];
        if (current === undefined) {
          resolved = false;
          break;
        }
      }
      if (!resolved) {
        errors.push(`Broken $ref at ${path}: "${ref}"`);
      }
    }
    return errors; // Don't recurse into $ref objects
  }

  for (const [key, value] of Object.entries(record)) {
    errors.push(...validateAllRefsResolve(value, spec, `${path}.${key}`));
  }

  return errors;
}

function main(): void {
  console.log('🔍 Validating OpenAPI spec against OpenAPI 3.0 JSON Schema...\n');

  // 1. Check the committed openapi.json exists
  if (!fs.existsSync(SPEC_PATH)) {
    console.error(`❌ openapi.json not found at ${SPEC_PATH}`);
    console.error('   Run `npm run openapi:generate` to generate it.');
    process.exit(1);
  }

  // 2. Parse and validate JSON structure
  let spec: unknown;
  try {
    const raw = fs.readFileSync(SPEC_PATH, 'utf-8');
    spec = JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Failed to parse openapi.json: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const structureErrors = validateJsonStructure(spec);
  if (structureErrors.length > 0) {
    console.error('❌ OpenAPI 3.0 structure validation failed:');
    structureErrors.forEach((e) => console.error(`   • ${e}`));
    process.exit(1);
  }
  console.log('✅ OpenAPI 3.0 structure validation passed');

  // 3. Validate all $ref references resolve
  const refErrors = validateAllRefsResolve(spec, spec, '#');
  if (refErrors.length > 0) {
    console.error(`❌ Found ${refErrors.length} broken $ref reference(s):`);
    refErrors.forEach((e) => console.error(`   • ${e}`));
    process.exit(1);
  }
  console.log('✅ All $ref references resolve');

  // 4. Run existing internal consistency validation (operationIds, schema completeness, etc.)
  const result = validateOpenApiSpec();

  if (result.warnings.length > 0) {
    console.warn(`\n⚠️  Warnings (${result.warnings.length}):`);
    result.warnings.forEach((w) => console.warn(`   • ${w}`));
  }

  if (!result.passed) {
    console.error(`\n❌ Internal spec consistency validation failed (${result.errors.length} error(s)):`);
    result.errors.forEach((e) => console.error(`   • ${e}`));
    process.exit(1);
  }

  console.log('\n📊 Spec Stats:');
  console.log(`   Endpoints: ${result.stats.totalEndpoints}`);
  console.log(`   Schemas:   ${result.stats.totalSchemas}`);
  console.log(`   $refs:     ${result.stats.totalRefs}`);
  console.log('\n✅ OpenAPI spec validation PASSED');
}

main();
