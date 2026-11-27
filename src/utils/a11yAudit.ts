/**
 * Accessibility audit helper (Issue #1356).
 *
 * Wraps `jest-axe` so screen render tests can assert that a rendered tree has
 * no critical or serious accessibility violations. Only `critical` and
 * `serious` impact levels fail the audit; `moderate`/`minor` findings are
 * reported through the returned result so they can be triaged separately.
 *
 * Usage:
 *   const { container } = render(<PetListScreen ... />);
 *   await expectNoA11yViolations(container);
 */
import { axe, type AxeResults, type Result } from 'jest-axe';

/** Impact levels that fail CI. */
export const BLOCKING_IMPACTS = ['critical', 'serious'] as const;

export type BlockingImpact = (typeof BLOCKING_IMPACTS)[number];

export interface A11yAuditResult {
  /** Violations at `critical` or `serious` impact. */
  blocking: Result[];
  /** All violations returned by axe, including non-blocking ones. */
  all: Result[];
  /** Raw axe results, for debugging. */
  raw: AxeResults;
}

const isBlocking = (violation: Result): boolean =>
  BLOCKING_IMPACTS.includes(violation.impact as BlockingImpact);

/**
 * Runs an axe audit against a rendered React Native tree.
 *
 * @param container The rendered tree (e.g. `render(...).container` or `toJSON()`).
 * @param options Optional axe run options (rules, tags, …).
 */
export async function auditAccessibility(
  container: unknown,
  options?: Parameters<typeof axe>[1],
): Promise<A11yAuditResult> {
  const raw = await axe(container as never, options);
  const all = raw.violations ?? [];
  return { blocking: all.filter(isBlocking), all, raw };
}

/** Formats blocking violations into a readable failure message. */
export function formatViolations(violations: Result[]): string {
  return violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join('\n');
}

/**
 * Asserts that a rendered tree has no critical or serious accessibility
 * violations. Throws with a readable summary when it does.
 */
export async function expectNoA11yViolations(
  container: unknown,
  options?: Parameters<typeof axe>[1],
): Promise<A11yAuditResult> {
  const result = await auditAccessibility(container, options);
  if (result.blocking.length > 0) {
    throw new Error(
      `Accessibility audit failed with ${result.blocking.length} critical/serious violation(s):\n` +
        formatViolations(result.blocking),
    );
  }
  return result;
}
