/**
 * OpenAPI spec generator script.
 *
 * Generates openapi.json from the TypeScript spec source (backend/docs/openapi/spec.ts)
 * and writes it to backend/docs/openapi.json.
 *
 * Usage:
 *   npx tsx scripts/generate-openapi.ts
 *   npx tsx scripts/generate-openapi.ts --check   # Exit 1 if generated spec differs from committed
 *
 * The --check flag is used in CI to detect unintentional API contract changes.
 * If the spec drifts, the developer must regenerate and commit the updated spec.
 */

import * as fs from 'fs';
import * as path from 'path';

import { openApiSpec } from '../backend/docs/openapi/spec';

const SPEC_OUTPUT_PATH = path.resolve(__dirname, '../backend/docs/openapi.json');
const CHECK_MODE = process.argv.includes('--check');

function generateSpec(): string {
  return JSON.stringify(openApiSpec, null, 2);
}

function main(): void {
  const generated = generateSpec();

  if (CHECK_MODE) {
    // In CI: compare the generated spec against the committed one
    if (!fs.existsSync(SPEC_OUTPUT_PATH)) {
      console.error('❌ openapi.json does not exist. Run `npm run openapi:generate` and commit it.');
      process.exit(1);
    }

    const committed = fs.readFileSync(SPEC_OUTPUT_PATH, 'utf-8');

    let committedObj: unknown;
    let generatedObj: unknown;
    try {
      committedObj = JSON.parse(committed);
      generatedObj = JSON.parse(generated);
    } catch (err) {
      console.error('❌ Failed to parse JSON:', err);
      process.exit(1);
    }

    const committedNorm = JSON.stringify(committedObj, null, 2);
    const generatedNorm = JSON.stringify(generatedObj, null, 2);

    if (committedNorm !== generatedNorm) {
      console.error('❌ The committed openapi.json is out of sync with the TypeScript spec source.');
      console.error('');
      console.error('   The API spec has changed but openapi.json was not regenerated.');
      console.error('   To fix: run `npm run openapi:generate`, review the diff, and commit the updated spec.');
      console.error('');
      console.error('   This check exists so that API contract changes are always intentional and visible in PR review.');
      process.exit(1);
    }

    console.log('✅ openapi.json is in sync with the TypeScript spec source.');
    process.exit(0);
  }

  // Write mode: generate and write the spec
  fs.writeFileSync(SPEC_OUTPUT_PATH, generated, 'utf-8');
  console.log(`✅ openapi.json written to ${SPEC_OUTPUT_PATH}`);
}

main();
