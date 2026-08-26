jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('../performance', () => ({
  recordMetric: jest.fn(),
  setPerformanceBudget: jest.fn(),
}));

import { recordMetric, setPerformanceBudget } from '../performance';
import {
  assertStartupBudgets,
  checkStartupBudget,
  getStartupBudget,
  REGRESSION_TOLERANCE,
  reportStartupMeasurement,
  STARTUP_BUDGETS,
} from '../startupBudget';

describe('getStartupBudget', () => {
  it('returns the platform + phase specific budget', () => {
    expect(getStartupBudget('cold', 'ios')).toEqual(STARTUP_BUDGETS.ios.cold);
    expect(getStartupBudget('warm', 'android')).toEqual(STARTUP_BUDGETS.android.warm);
  });

  it('falls back to the android envelope for an unknown platform', () => {
    // @ts-expect-error deliberately passing an unsupported platform
    expect(getStartupBudget('cold', 'tvos')).toEqual(STARTUP_BUDGETS.android.cold);
  });
});

describe('checkStartupBudget', () => {
  it('passes a measurement that is within budget', () => {
    const result = checkStartupBudget({
      phase: 'cold',
      platform: 'android',
      timeToInteractiveMs: STARTUP_BUDGETS.android.cold.timeToInteractiveMs - 100,
      residentMemoryMiB: STARTUP_BUDGETS.android.cold.residentMemoryMiB - 10,
    });
    expect(result.regressed).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  it('tolerates a small overshoot within REGRESSION_TOLERANCE', () => {
    const budget = STARTUP_BUDGETS.android.cold;
    const result = checkStartupBudget({
      phase: 'cold',
      platform: 'android',
      timeToInteractiveMs: Math.round(budget.timeToInteractiveMs * (1 + REGRESSION_TOLERANCE / 2)),
      residentMemoryMiB: budget.residentMemoryMiB,
    });
    expect(result.regressed).toBe(false);
  });

  it('flags a material time regression', () => {
    const budget = STARTUP_BUDGETS.ios.cold;
    const result = checkStartupBudget({
      phase: 'cold',
      platform: 'ios',
      timeToInteractiveMs: budget.timeToInteractiveMs * 1.5,
      residentMemoryMiB: budget.residentMemoryMiB,
    });
    expect(result.regressed).toBe(true);
    expect(result.violations[0]).toMatch(/exceeds/);
  });

  it('flags a material memory regression', () => {
    const budget = STARTUP_BUDGETS.android.warm;
    const result = checkStartupBudget({
      phase: 'warm',
      platform: 'android',
      timeToInteractiveMs: budget.timeToInteractiveMs,
      residentMemoryMiB: budget.residentMemoryMiB * 2,
    });
    expect(result.regressed).toBe(true);
    expect(result.memoryOverBudgetRatio).toBeGreaterThan(REGRESSION_TOLERANCE);
  });
});

describe('reportStartupMeasurement', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records metrics and budgets to Sentry', () => {
    reportStartupMeasurement({
      phase: 'cold',
      platform: 'android',
      timeToInteractiveMs: 1500,
      residentMemoryMiB: 150,
    });
    expect(recordMetric).toHaveBeenCalledWith('startup.cold.tti_ms', 1500, { platform: 'android' });
    expect(recordMetric).toHaveBeenCalledWith('startup.cold.memory_mib', 150, {
      platform: 'android',
    });
    expect(setPerformanceBudget).toHaveBeenCalledWith(
      'startup.cold.tti_ms',
      STARTUP_BUDGETS.android.cold.timeToInteractiveMs,
    );
  });
});

describe('assertStartupBudgets', () => {
  it('returns results when every measurement is within budget', () => {
    const results = assertStartupBudgets([
      { phase: 'cold', platform: 'ios', timeToInteractiveMs: 1000, residentMemoryMiB: 120 },
      { phase: 'warm', platform: 'android', timeToInteractiveMs: 500, residentMemoryMiB: 150 },
    ]);
    expect(results).toHaveLength(2);
  });

  it('throws a combined error listing every regression', () => {
    expect(() =>
      assertStartupBudgets([
        { phase: 'cold', platform: 'ios', timeToInteractiveMs: 9000, residentMemoryMiB: 900 },
        { phase: 'warm', platform: 'android', timeToInteractiveMs: 100, residentMemoryMiB: 100 },
      ]),
    ).toThrow(/Startup budget regression detected/);
  });
});
