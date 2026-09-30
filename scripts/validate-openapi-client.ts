/**
 * Contract check: handwritten mobile services vs. backend OpenAPI (#977)
 *
 * Handwritten services in `src/services` can silently drift from the backend
 * DTOs and routes documented in `backend/docs/openapi.json`. This script scans
 * the service layer for the REST endpoints it calls and fails when one is not
 * documented in the spec — so an undocumented backend change (or a typo in a
 * client path) breaks CI instead of shipping.
 *
 * Detection is deliberately conservative: it only inspects literal
 *   apiClient.<method>('/path' …) / api.<method>('/path' …) / authClient.<method>('/path' …)
 * call sites and template literals, normalizing dynamic segments
 * (`${x}`, `:id`) to the `{param}` form used by the spec. Anything it cannot
 * statically resolve is reported as "unresolved", not a failure.
 *
 * The repo already carries historical drift, so CI does not fail on the whole
 * set — it fails on *new* drift only. `scripts/openapi-client-baseline.json`
 * snapshots the currently-known undocumented endpoints; `--strict` fails when a
 * call site outside that baseline is undocumented. Shrinking the baseline (by
 * documenting an endpoint) is always allowed and encouraged.
 *
 * Usage:
 *   npx tsx scripts/validate-openapi-client.ts                    # full report
 *   npx tsx scripts/validate-openapi-client.ts --strict           # exit 1 on NEW drift (CI)
 *   npx tsx scripts/validate-openapi-client.ts --update-baseline  # re-snapshot known drift
 *
 * Exit codes: 0 ok, 1 new undocumented endpoint(s) under --strict.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SPEC_PATH = path.join(ROOT, 'backend/docs/openapi.json');
const SERVICES_DIR = path.join(ROOT, 'src/services');
const BASELINE_PATH = path.join(ROOT, 'scripts/openapi-client-baseline.json');
const STRICT = process.argv.includes('--strict');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;
type Method = (typeof HTTP_METHODS)[number];

interface CallSite {
  file: string;
  method: Method;
  rawPath: string;
  normalized: string;
}

/** Normalize a client path to the spec's templated form. */
export function normalizePath(raw: string): string {
  let p = raw.trim();
  p = p.split('?')[0]; // drop query string
  p = p.replace(/\$\{[^}]+\}/g, '{param}'); // `${petId}` → `{param}`
  p = p.replace(/:[A-Za-z0-9_]+/g, '{param}'); // `:id` → `{param}`
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '') || '/';
  return p;
}

/** Reduce every templated segment of a spec path to `{param}` for comparison. */
function specKey(specPath: string): string {
  return specPath.replace(/\{[^}]+\}/g, '{param}');
}

function loadDocumentedRoutes(): Map<string, Set<Method>> {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8')) as {
    paths?: Record<string, Record<string, unknown>>;
  };
  const routes = new Map<string, Set<Method>>();
  for (const [rawPath, ops] of Object.entries(spec.paths ?? {})) {
    const key = specKey(rawPath);
    const methods = new Set<Method>();
    for (const m of Object.keys(ops)) {
      if ((HTTP_METHODS as readonly string[]).includes(m)) methods.add(m as Method);
    }
    routes.set(key, methods);
  }
  return routes;
}

const CALL_RE =
  /\b(?:apiClient|api|authClient|resilientRequest|rateLimitedRequest)\s*\.\s*(get|post|put|patch|delete|head)\s*\(\s*(['"`])([^'"`]+)\2/g;

function scanServices(): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of fs.readdirSync(SERVICES_DIR)) {
    if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
    const full = path.join(SERVICES_DIR, file);
    if (!fs.statSync(full).isFile()) continue;
    const src = fs.readFileSync(full, 'utf-8');
    for (const m of src.matchAll(CALL_RE)) {
      const method = m[1] as Method;
      const rawPath = m[3];
      if (rawPath.startsWith('http')) continue; // absolute URL — not a spec route
      sites.push({ file, method, rawPath, normalized: normalizePath(rawPath) });
    }
  }
  return sites;
}

export function findUndocumented(
  sites: CallSite[],
  routes: Map<string, Set<Method>>,
): CallSite[] {
  return sites.filter((s) => {
    const methods = routes.get(specKey(s.normalized));
    return !methods || !methods.has(s.method);
  });
}

/** Stable signature for baseline membership: `METHOD path`. */
export function siteSignature(s: Pick<CallSite, 'method' | 'normalized'>): string {
  return `${s.method.toUpperCase()} ${s.normalized}`;
}

function loadBaseline(): Set<string> {
  if (!fs.existsSync(BASELINE_PATH)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as { undocumented?: string[] };
  return new Set(parsed.undocumented ?? []);
}

function main(): void {
  if (!fs.existsSync(SPEC_PATH)) {
    console.error(`❌ OpenAPI spec not found at ${SPEC_PATH}`);
    process.exit(1);
  }
  const routes = loadDocumentedRoutes();
  const sites = scanServices();
  const undocumented = findUndocumented(sites, routes);
  const undocumentedSigs = [...new Set(undocumented.map(siteSignature))].sort();

  console.log(
    `Scanned ${sites.length} client call site(s) against ${routes.size} documented route(s).`,
  );

  if (UPDATE_BASELINE) {
    fs.writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(
        {
          $comment:
            'Known-undocumented mobile endpoints (#977). CI fails only on entries NOT listed here. Shrink this list by documenting endpoints in backend/docs/openapi.json.',
          undocumented: undocumentedSigs,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`📌 Baseline updated: ${undocumentedSigs.length} known-undocumented endpoint(s).`);
    return;
  }

  const baseline = loadBaseline();
  const newDrift = undocumentedSigs.filter((sig) => !baseline.has(sig));
  const fixed = [...baseline].filter((sig) => !undocumentedSigs.includes(sig));

  if (undocumentedSigs.length === 0) {
    console.log('✅ Every statically-resolvable mobile endpoint is documented in the OpenAPI spec.');
    return;
  }

  console.log(
    `\n${undocumentedSigs.length} undocumented endpoint(s) — ${baseline.size} baselined, ${newDrift.length} new:`,
  );
  for (const u of undocumented) {
    const tag = baseline.has(siteSignature(u)) ? '  ' : '🆕';
    console.log(
      `  ${tag} ${u.method.toUpperCase().padEnd(6)} ${u.normalized}   (${u.file} → "${u.rawPath}")`,
    );
  }

  if (fixed.length > 0) {
    console.log(
      `\n👍 ${fixed.length} previously-undocumented endpoint(s) now documented. Run --update-baseline to shrink the baseline:`,
    );
    fixed.forEach((sig) => console.log(`     ${sig}`));
  }

  if (newDrift.length > 0 && STRICT) {
    console.error(
      `\n❌ ${newDrift.length} NEW undocumented endpoint(s). Document them in backend/docs/openapi.json (see #977):`,
    );
    newDrift.forEach((sig) => console.error(`     ${sig}`));
    process.exit(1);
  }
  if (newDrift.length === 0) {
    console.log('\n✅ No new drift beyond the committed baseline.');
  }
}

if (require.main === module) main();
