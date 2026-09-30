import { Platform } from 'react-native';

import { recordMetric, setPerformanceBudget } from './performance';

/**
 * Startup performance & memory budgets.
 *
 * Many providers, update checks, notification tasks, widgets and Sentry
 * initialise at launch (see {@link ../../App.tsx}). This module gives us a
 * single place to declare how long that work is *allowed* to take and how much
 * memory the app may hold shortly after the first frame, plus helpers to
 * measure the real numbers and flag material regressions in CI.
 *
 * The budgets are deliberately conservative for the low-end reference devices
 * documented in `docs/performance-budgets.md`. Tightening them is a one-line
 * change here; loosening them requires a PR review.
 */

export type StartupPhase = 'cold' | 'warm';

export interface StartupBudget {
  /** Time (ms) from process start to the first interactive frame. */
  timeToInteractiveMs: number;
  /** Resident memory (MiB) sampled ~2s after the first frame. */
  residentMemoryMiB: number;
}

/**
 * Per-platform, per-phase budgets. Numbers reflect the slowest device we
 * officially support (see docs) with a small amount of headroom.
 */
export const STARTUP_BUDGETS: Record<typeof Platform.OS, Record<StartupPhase, StartupBudget>> = {
  ios: {
    cold: { timeToInteractiveMs: 1800, residentMemoryMiB: 180 },
    warm: { timeToInteractiveMs: 700, residentMemoryMiB: 180 },
  },
  android: {
    cold: { timeToInteractiveMs: 2400, residentMemoryMiB: 220 },
    warm: { timeToInteractiveMs: 900, residentMemoryMiB: 220 },
  },
  // React Native also reports these platforms; use the Android envelope as a
  // safe default so a mis-detected platform never silently disables the gate.
  windows: {
    cold: { timeToInteractiveMs: 2400, residentMemoryMiB: 220 },
    warm: { timeToInteractiveMs: 900, residentMemoryMiB: 220 },
  },
  macos: {
    cold: { timeToInteractiveMs: 1800, residentMemoryMiB: 180 },
    warm: { timeToInteractiveMs: 700, residentMemoryMiB: 180 },
  },
  web: {
    cold: { timeToInteractiveMs: 3000, residentMemoryMiB: 260 },
    warm: { timeToInteractiveMs: 1200, residentMemoryMiB: 260 },
  },
};

/**
 * How much worse than budget a measurement may be before we treat it as a
 * *material* regression. 10% absorbs normal device/CI jitter; anything beyond
 * that should fail the build.
 */
export const REGRESSION_TOLERANCE = 0.1;

export interface StartupMeasurement {
  phase: StartupPhase;
  timeToInteractiveMs: number;
  residentMemoryMiB: number;
  platform?: typeof Platform.OS;
}

export interface BudgetCheckResult {
  phase: StartupPhase;
  platform: typeof Platform.OS;
  budget: StartupBudget;
  measurement: Pick<StartupMeasurement, 'timeToInteractiveMs' | 'residentMemoryMiB'>;
  /** Positive = over budget, negative = under. Fraction of the budget. */
  timeOverBudgetRatio: number;
  memoryOverBudgetRatio: number;
  /** True when either metric exceeds the budget by more than the tolerance. */
  regressed: boolean;
  violations: string[];
}

export function getStartupBudget(
  phase: StartupPhase,
  platform: typeof Platform.OS = Platform.OS,
): StartupBudget {
  return (STARTUP_BUDGETS[platform] ?? STARTUP_BUDGETS.android)[phase];
}

/**
 * Compare a measurement against its budget. Pure and side-effect free so it can
 * be unit tested and reused by the CI reporter.
 */
export function checkStartupBudget(measurement: StartupMeasurement): BudgetCheckResult {
  const platform = measurement.platform ?? Platform.OS;
  const budget = getStartupBudget(measurement.phase, platform);

  const timeOverBudgetRatio =
    (measurement.timeToInteractiveMs - budget.timeToInteractiveMs) / budget.timeToInteractiveMs;
  const memoryOverBudgetRatio =
    (measurement.residentMemoryMiB - budget.residentMemoryMiB) / budget.residentMemoryMiB;

  const violations: string[] = [];
  if (timeOverBudgetRatio > REGRESSION_TOLERANCE) {
    violations.push(
      `${measurement.phase} start ${measurement.timeToInteractiveMs}ms exceeds ` +
        `${budget.timeToInteractiveMs}ms budget by ${(timeOverBudgetRatio * 100).toFixed(1)}%`,
    );
  }
  if (memoryOverBudgetRatio > REGRESSION_TOLERANCE) {
    violations.push(
      `${measurement.phase} memory ${measurement.residentMemoryMiB}MiB exceeds ` +
        `${budget.residentMemoryMiB}MiB budget by ${(memoryOverBudgetRatio * 100).toFixed(1)}%`,
    );
  }

  return {
    phase: measurement.phase,
    platform,
    budget,
    measurement: {
      timeToInteractiveMs: measurement.timeToInteractiveMs,
      residentMemoryMiB: measurement.residentMemoryMiB,
    },
    timeOverBudgetRatio,
    memoryOverBudgetRatio,
    regressed: violations.length > 0,
    violations,
  };
}

/**
 * Record a startup measurement to Sentry (as metrics + budget breadcrumbs) and
 * return the budget check. Call this once the first interactive frame has been
 * rendered and a memory sample is available.
 */
export function reportStartupMeasurement(measurement: StartupMeasurement): BudgetCheckResult {
  const result = checkStartupBudget(measurement);

  recordMetric(`startup.${measurement.phase}.tti_ms`, measurement.timeToInteractiveMs, {
    platform: result.platform,
  });
  recordMetric(`startup.${measurement.phase}.memory_mib`, measurement.residentMemoryMiB, {
    platform: result.platform,
  });
  setPerformanceBudget(`startup.${measurement.phase}.tti_ms`, result.budget.timeToInteractiveMs);
  setPerformanceBudget(`startup.${measurement.phase}.memory_mib`, result.budget.residentMemoryMiB);

  return result;
}

/**
 * Assert a batch of measurements against their budgets. Intended for the CI
 * performance job: throws with a combined message when any measurement shows a
 * material regression, otherwise returns the per-measurement results.
 */
export function assertStartupBudgets(measurements: StartupMeasurement[]): BudgetCheckResult[] {
  const results = measurements.map(checkStartupBudget);
  const failing = results.filter((r) => r.regressed);
  if (failing.length > 0) {
    const detail = failing.flatMap((r) => r.violations).join('\n  - ');
    throw new Error(`Startup budget regression detected:\n  - ${detail}`);
  }
  return results;
}

export default {
  STARTUP_BUDGETS,
  REGRESSION_TOLERANCE,
  getStartupBudget,
  checkStartupBudget,
  reportStartupMeasurement,
  assertStartupBudgets,
};
