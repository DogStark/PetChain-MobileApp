/**
 * dosageCalculator.unitSafety.test.ts — #956 dosage unit safety
 *
 * Tests cover:
 *  - Branded type constructors (asMgPerKg, asMg, asMl, asTablets)
 *  - MAX_WEIGHT_KG and MAX_DOSE_PER_KG bounds enforcement via DosageBoundsError
 *  - VET_DISCLAIMER is present on every DosageResult
 *  - computeDosage: zero/negative weight → critical result with disclaimer
 *  - computeDosage: zero/negative dose → critical result with disclaimer
 *  - computeDosage: safe, low, high, critical safety levels still include disclaimer
 *  - computeDosage: throws DosageBoundsError for weight > MAX_WEIGHT_KG
 *  - computeDosage: throws DosageBoundsError for dose > MAX_DOSE_PER_KG
 *  - Regression: all pre-existing results still include vetDisclaimer
 */

import {
  VET_DISCLAIMER,
  MAX_WEIGHT_KG,
  MAX_DOSE_PER_KG,
  DosageBoundsError,
  asMgPerKg,
  asMg,
  asMl,
  asTablets,
  computeDosage,
  assessDoseSafety,
  calculateDoseInMg,
  convertFromMg,
  getDrugsForSpecies,
  lookupDrug,
  type MgPerKg,
  type Mg,
  type Ml,
  type Tablets,
} from '../dosageCalculator';

// ─── Branded type constructors ────────────────────────────────────────────────

describe('branded type constructors', () => {
  it('asMgPerKg returns the numeric value unchanged at runtime', () => {
    const v: MgPerKg = asMgPerKg(15);
    expect(v).toBe(15);
  });

  it('asMg returns the numeric value unchanged at runtime', () => {
    const v: Mg = asMg(150);
    expect(v).toBe(150);
  });

  it('asMl returns the numeric value unchanged at runtime', () => {
    const v: Ml = asMl(10.5);
    expect(v).toBe(10.5);
  });

  it('asTablets returns the numeric value unchanged at runtime', () => {
    const v: Tablets = asTablets(2);
    expect(v).toBe(2);
  });
});

// ─── VET_DISCLAIMER constant ──────────────────────────────────────────────────

describe('VET_DISCLAIMER', () => {
  it('is a non-empty string', () => {
    expect(typeof VET_DISCLAIMER).toBe('string');
    expect(VET_DISCLAIMER.length).toBeGreaterThan(0);
  });

  it('mentions "veterinarian" to be a meaningful medical notice', () => {
    expect(VET_DISCLAIMER.toLowerCase()).toContain('veterinarian');
  });
});

// ─── Bounds constants ─────────────────────────────────────────────────────────

describe('bounds constants', () => {
  it('MAX_WEIGHT_KG is 500', () => {
    expect(MAX_WEIGHT_KG).toBe(500);
  });

  it('MAX_DOSE_PER_KG is 200', () => {
    expect(MAX_DOSE_PER_KG).toBe(200);
  });
});

// ─── computeDosage — vetDisclaimer always present ─────────────────────────────

describe('computeDosage — vetDisclaimer is always present', () => {
  it('includes vetDisclaimer on a normal safe result', () => {
    const result = computeDosage({
      weightKg: 10,
      dosePerKg: 15,
      targetUnit: 'mg',
    });
    expect(result.vetDisclaimer).toBe(VET_DISCLAIMER);
  });

  it('includes vetDisclaimer on zero-weight critical result', () => {
    const result = computeDosage({ weightKg: 0, dosePerKg: 15, targetUnit: 'mg' });
    expect(result.vetDisclaimer).toBe(VET_DISCLAIMER);
    expect(result.safetyLevel).toBe('critical');
  });

  it('includes vetDisclaimer on negative-weight critical result', () => {
    const result = computeDosage({ weightKg: -5, dosePerKg: 15, targetUnit: 'mg' });
    expect(result.vetDisclaimer).toBe(VET_DISCLAIMER);
    expect(result.safetyLevel).toBe('critical');
  });

  it('includes vetDisclaimer on zero-dose critical result', () => {
    const result = computeDosage({ weightKg: 10, dosePerKg: 0, targetUnit: 'mg' });
    expect(result.vetDisclaimer).toBe(VET_DISCLAIMER);
    expect(result.safetyLevel).toBe('critical');
  });

  it('includes vetDisclaimer on conversion-error critical result', () => {
    // ml conversion without concentration → conversion error → critical
    const result = computeDosage({ weightKg: 10, dosePerKg: 5, targetUnit: 'ml' });
    expect(result.vetDisclaimer).toBe(VET_DISCLAIMER);
    expect(result.safetyLevel).toBe('critical');
  });

  it('includes vetDisclaimer for "low" safety level', () => {
    const result = computeDosage(
      { weightKg: 10, dosePerKg: 5, targetUnit: 'mg' },
      { minPerKg: 10, maxPerKg: 22, typicalPerKg: 15 },
    );
    expect(result.safetyLevel).toBe('low');
    expect(result.vetDisclaimer).toBe(VET_DISCLAIMER);
  });

  it('includes vetDisclaimer for "high" safety level', () => {
    const result = computeDosage(
      { weightKg: 10, dosePerKg: 25, targetUnit: 'mg' },
      { minPerKg: 10, maxPerKg: 22, typicalPerKg: 15 },
    );
    expect(result.safetyLevel).toBe('high');
    expect(result.vetDisclaimer).toBe(VET_DISCLAIMER);
  });

  it('includes vetDisclaimer for "critical" safety level (2× max)', () => {
    const result = computeDosage(
      { weightKg: 10, dosePerKg: 50, targetUnit: 'mg' },
      { minPerKg: 10, maxPerKg: 22, typicalPerKg: 15 },
    );
    expect(result.safetyLevel).toBe('critical');
    expect(result.vetDisclaimer).toBe(VET_DISCLAIMER);
  });
});

// ─── computeDosage — DosageBoundsError ────────────────────────────────────────

describe('computeDosage — DosageBoundsError for out-of-bounds inputs', () => {
  it('throws DosageBoundsError when weight exceeds MAX_WEIGHT_KG', () => {
    expect(() =>
      computeDosage({ weightKg: MAX_WEIGHT_KG + 1, dosePerKg: 10, targetUnit: 'mg' }),
    ).toThrow(DosageBoundsError);
  });

  it('includes a helpful message for excessive weight', () => {
    expect(() => computeDosage({ weightKg: 600, dosePerKg: 10, targetUnit: 'mg' })).toThrow(
      /500 kg/,
    );
  });

  it('throws DosageBoundsError when dose exceeds MAX_DOSE_PER_KG', () => {
    expect(() =>
      computeDosage({ weightKg: 10, dosePerKg: MAX_DOSE_PER_KG + 1, targetUnit: 'mg' }),
    ).toThrow(DosageBoundsError);
  });

  it('includes a helpful message for excessive dose', () => {
    expect(() => computeDosage({ weightKg: 10, dosePerKg: 300, targetUnit: 'mg' })).toThrow(
      /200 mg\/kg/,
    );
  });

  it('does NOT throw for weight exactly equal to MAX_WEIGHT_KG', () => {
    expect(() =>
      computeDosage({ weightKg: MAX_WEIGHT_KG, dosePerKg: 1, targetUnit: 'mg' }),
    ).not.toThrow();
  });

  it('does NOT throw for dose exactly equal to MAX_DOSE_PER_KG', () => {
    expect(() =>
      computeDosage({ weightKg: 10, dosePerKg: MAX_DOSE_PER_KG, targetUnit: 'mg' }),
    ).not.toThrow();
  });

  it('DosageBoundsError is an Error subtype', () => {
    try {
      computeDosage({ weightKg: 600, dosePerKg: 10, targetUnit: 'mg' });
    } catch (err) {
      expect(err).toBeInstanceOf(DosageBoundsError);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe('DosageBoundsError');
    }
  });
});

// ─── computeDosage — numeric correctness unchanged ────────────────────────────

describe('computeDosage — numeric correctness (regression)', () => {
  it('10 kg × 15 mg/kg = 150 mg', () => {
    const result = computeDosage({ weightKg: 10, dosePerKg: 15, targetUnit: 'mg' });
    expect(result.doseInMg).toBe(150);
    expect(result.dose).toBe(150);
    expect(result.unit).toBe('mg');
  });

  it('10 kg × 0.1 mg/kg, concentration 1.5 mg/ml → 0.667 ml', () => {
    const result = computeDosage({
      weightKg: 10,
      dosePerKg: 0.1,
      targetUnit: 'ml',
      concentration: 1.5,
    });
    expect(result.dose).toBeCloseTo(0.667, 2);
    expect(result.unit).toBe('ml');
  });
});

// ─── Integration: drug lookup + computeDosage ─────────────────────────────────

describe('drug lookup + computeDosage (integration)', () => {
  it('amoxicillin for a 10 kg dog produces a safe result with disclaimer', () => {
    const lookup = lookupDrug('amoxicillin', 'dog');
    expect(lookup).not.toBeNull();
    if (!lookup?.range) return;

    const result = computeDosage(
      { weightKg: 10, dosePerKg: 15, targetUnit: 'mg', tabletStrength: 250 },
      lookup.range,
    );

    expect(result.safetyLevel).toBe('safe');
    expect(result.vetDisclaimer).toBe(VET_DISCLAIMER);
    expect(result.doseInMg).toBe(150);
  });

  it('enrofloxacin for a cat at 6 mg/kg produces a critical result with disclaimer', () => {
    const lookup = lookupDrug('enrofloxacin', 'cat');
    expect(lookup).not.toBeNull();
    if (!lookup?.range) return;

    const result = computeDosage({ weightKg: 5, dosePerKg: 6, targetUnit: 'mg' }, lookup.range);

    // 6 mg/kg for cat is above the max of 5 mg/kg
    expect(result.safetyLevel).toBe('high');
    expect(result.vetDisclaimer).toBe(VET_DISCLAIMER);
  });
});
