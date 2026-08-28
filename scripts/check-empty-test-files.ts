import fs from 'fs';
import path from 'path';

const MIN_TEST_CASES = 3;
const TODO_SUPPRESS_REGEX = /\/\/\s*TODO:\s*#\d+/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

function findTestFiles(dir: string, results: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findTestFiles(fullPath, results);
      continue;
    }

    if (entry.name.endsWith('.test.ts') && fullPath.includes(`${path.sep}__tests__${path.sep}`)) {
      results.push(fullPath);
    }
  }

  return results;
}

function countTestCases(content: string): number {
  const matches = content.match(/\b(it|test|describe)\s*\(/g);
  return matches?.length ?? 0;
}

function hasSuppressComment(content: string): boolean {
  return TODO_SUPPRESS_REGEX.test(content);
}

export { countTestCases, hasSuppressComment, MIN_TEST_CASES };

function main(): void {
  const root = process.cwd();
  const files = findTestFiles(root).sort();
  const failures: string[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
    const stat = fs.statSync(filePath);

    if (stat.size === 0) {
      failures.push(`${relativePath}: file is empty (0 bytes)`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    if (hasSuppressComment(content)) {
      continue;
    }

    const caseCount = countTestCases(content);
    if (caseCount < MIN_TEST_CASES) {
      failures.push(
        `${relativePath}: only ${caseCount} test case block(s) found (minimum ${MIN_TEST_CASES})`,
      );
    }
  }

  if (failures.length > 0) {
    console.error('Empty or insufficient test files detected:\n');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    console.error(
      '\nEscape hatch: add `// TODO: #<issue-number>` to intentionally stub a test file.',
    );
    process.exit(1);
  }

  console.log(`Checked ${files.length} test files — all meet minimum requirements.`);
}

if (require.main === module) {
  main();
}
