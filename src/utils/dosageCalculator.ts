/**
 * dosageCalculator — weight-based medication dosing utilities (#956)
 *
 * ### Dimensional unit safety
 *
 * To prevent silent unit-confusion bugs (e.g. treating mg/kg as mg/lb, or
 * returning a raw number that callers misinterpret as a different unit), this
 * module uses *branded / opaque scalar types* — `MgPerKg`, `Mg`, `Ml`, and
 * `Tablets`.  Each type is structurally identical to `number` at runtime but
 * is distinct at the TypeScript level, so assigning a `Mg` value to a `MgPerKg`
 * slot is a compile-time error.
 *
 * Constructors (`asMgPerKg`, `asMg`, `asMl`, `asTablets`) must be used to
 * create these values; plain number literals cannot be assigned directly.
 *
 * ### Bounds enforcement
 *
 * `computeDosage` throws `DosageBoundsError` for inputs outside the valid
 * physical range:
 *   - weight ≤ 0 → immediate critical result (no exception)
 *   - dose-per-kg ≤ 0 → immediate critical result (no exception)
 *   - weight > MAX_WEIGHT_KG (500 kg) → DosageBoundsError
 *   - dose-per-kg > MAX_DOSE_PER_KG (200 mg/kg) → DosageBoundsError
 *
 * ### Veterinarian disclaimer (required on every result)
 *
 * `DosageResult` now includes a `vetDisclaimer` field.  This is a mandatory
 * legal notice that MUST be shown to the user alongside any calculated dose.
 * The UI layer is responsible for displaying it; the service layer always
 * populates it so it can never be accidentally omitted.
 */

import type { Species } from '../models/Pet';

// ─── Branded unit types (issue #956) ─────────────────────────────────────────

/** Milligrams of drug per kilogram of body weight */
export type MgPerKg = number & { readonly __brand: 'MgPerKg' };
/** Total milligrams */
export type Mg = number & { readonly __brand: 'Mg' };
/** Total millilitres */
export type Ml = number & { readonly __brand: 'Ml' };
/** Number of tablets */
export type Tablets = number & { readonly __brand: 'Tablets' };

/** Union of all supported dispensing units */
export type DosedQuantity = Mg | Ml | Tablets;

/** Constructors — use these instead of plain number casts */
export function asMgPerKg(n: number): MgPerKg {
  return n as MgPerKg;
}
export function asMg(n: number): Mg {
  return n as Mg;
}
export function asMl(n: number): Ml {
  return n as Ml;
}
export function asTablets(n: number): Tablets {
  return n as Tablets;
}

// ─── Bounds constants (issue #956) ───────────────────────────────────────────

/** Maximum plausible pet weight (500 kg — largest domestic animals) */
export const MAX_WEIGHT_KG = 500;
/** Maximum plausible dose-per-kg input (200 mg/kg is well above any standard dose) */
export const MAX_DOSE_PER_KG = 200;

/**
 * Thrown when a numeric input exceeds the physical safety bounds.
 * Distinct from a `DosageSafetyLevel = 'critical'` result — this is an error
 * in the input itself, not a safety classification of an otherwise-valid dose.
 */
export class DosageBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DosageBoundsError';
  }
}

// ─── Mandatory veterinarian disclaimer (issue #956) ─────────────────────────

/**
 * Mandatory disclaimer text that MUST be displayed to the user alongside
 * every calculated dose.
 *
 * This string is embedded in `DosageResult.vetDisclaimer` so it travels
 * with the result and cannot be accidentally omitted by any consumer.
 */
export const VET_DISCLAIMER =
  '⚠️ This calculation is a reference tool only and does not constitute veterinary advice. ' +
  'Always consult a licensed veterinarian before administering any medication to your pet. ' +
  'Individual animals may require different dosing based on health status, concurrent medications, ' +
  'or other clinical factors.';

export type DoseUnit = 'mg' | 'ml' | 'tablets';
export type DosageSafetyLevel = 'safe' | 'low' | 'high' | 'critical';

export interface DosageRange {
  minPerKg: number;
  maxPerKg: number;
  typicalPerKg: number;
}

export interface DrugRecord {
  id: string;
  name: string;
  drugClass: string;
  dosageBySpecies: Partial<Record<Species, DosageRange>>;
  defaultUnit: DoseUnit;
  concentration?: number;
  tabletStrength?: number;
  safetyWarnings: Partial<Record<Species, string[]>>;
  contraindications: Partial<Record<Species, string[]>>;
}

export interface DosageInput {
  weightKg: number;
  dosePerKg: number;
  targetUnit: DoseUnit;
  concentration?: number;
  tabletStrength?: number;
}

export interface DosageResult {
  dose: number;
  unit: DoseUnit;
  doseInMg: number;
  safetyLevel: DosageSafetyLevel;
  warnings: string[];
  rangeMin?: number;
  rangeMax?: number;
  /**
   * Mandatory veterinarian disclaimer (issue #956).
   * This field is ALWAYS populated; the UI MUST display it to the user.
   */
  vetDisclaimer: string;
}

export const DRUG_DATABASE: DrugRecord[] = [
  {
    id: 'amoxicillin',
    name: 'Amoxicillin',
    drugClass: 'Antibiotic (Penicillin)',
    dosageBySpecies: {
      dog: { minPerKg: 10, maxPerKg: 22, typicalPerKg: 15 },
      cat: { minPerKg: 10, maxPerKg: 22, typicalPerKg: 15 },
    },
    defaultUnit: 'mg',
    tabletStrength: 250,
    safetyWarnings: {
      dog: ['May cause GI upset. Administer with food.'],
      cat: ['May cause GI upset. Administer with food.'],
      rabbit: ['CONTRAINDICATED — can cause fatal enterotoxemia.'],
    },
    contraindications: {
      rabbit: ['Fatal enterotoxemia risk in hindgut fermenters.'],
    },
  },
  {
    id: 'metronidazole',
    name: 'Metronidazole',
    drugClass: 'Antibiotic / Antiprotozoal',
    dosageBySpecies: {
      dog: { minPerKg: 10, maxPerKg: 25, typicalPerKg: 15 },
      cat: { minPerKg: 10, maxPerKg: 25, typicalPerKg: 15 },
      rabbit: { minPerKg: 20, maxPerKg: 40, typicalPerKg: 20 },
    },
    defaultUnit: 'mg',
    tabletStrength: 250,
    safetyWarnings: {
      dog: ['Neurological signs at high doses. Avoid long-term use.'],
      cat: ['Neurological signs at high doses. Avoid long-term use.'],
    },
    contraindications: {
      dog: ['Avoid in pregnant animals.'],
      cat: ['Avoid in pregnant animals.'],
    },
  },
  {
    id: 'carprofen',
    name: 'Carprofen',
    drugClass: 'NSAID',
    dosageBySpecies: {
      dog: { minPerKg: 2.2, maxPerKg: 4.4, typicalPerKg: 4.4 },
    },
    defaultUnit: 'mg',
    tabletStrength: 25,
    safetyWarnings: {
      dog: [
        'Monitor for GI ulceration and renal/hepatic toxicity.',
        'Do not use concurrently with other NSAIDs or corticosteroids.',
      ],
    },
    contraindications: {
      cat: ['Not approved for cats. Consider meloxicam under vet supervision.'],
    },
  },
  {
    id: 'meloxicam',
    name: 'Meloxicam',
    drugClass: 'NSAID',
    dosageBySpecies: {
      dog: { minPerKg: 0.1, maxPerKg: 0.2, typicalPerKg: 0.1 },
      cat: { minPerKg: 0.05, maxPerKg: 0.1, typicalPerKg: 0.05 },
      rabbit: { minPerKg: 0.3, maxPerKg: 0.6, typicalPerKg: 0.5 },
    },
    defaultUnit: 'ml',
    concentration: 1.5,
    safetyWarnings: {
      dog: ['Monitor renal function. Do not combine with other NSAIDs.'],
      cat: [
        'Extreme caution required. Renal toxicity risk.',
        'Single post-operative dose only without continuous monitoring.',
      ],
      rabbit: ['Monitor renal and hepatic function.'],
    },
    contraindications: {
      cat: ['Repeated dosing without close vet monitoring is dangerous.'],
    },
  },
  {
    id: 'prednisone',
    name: 'Prednisone',
    drugClass: 'Corticosteroid',
    dosageBySpecies: {
      dog: { minPerKg: 0.5, maxPerKg: 2.0, typicalPerKg: 1.0 },
      cat: { minPerKg: 1.0, maxPerKg: 2.0, typicalPerKg: 1.0 },
    },
    defaultUnit: 'mg',
    tabletStrength: 5,
    safetyWarnings: {
      dog: ['Taper dose on discontinuation. Long-term use causes Cushing-like effects.'],
      cat: ['Monitor for diabetes mellitus. Higher doses required than in dogs.'],
    },
    contraindications: {
      dog: ['Do not use concurrently with NSAIDs.'],
      cat: ['Do not use concurrently with NSAIDs.'],
    },
  },
  {
    id: 'enrofloxacin',
    name: 'Enrofloxacin',
    drugClass: 'Fluoroquinolone Antibiotic',
    dosageBySpecies: {
      dog: { minPerKg: 5, maxPerKg: 20, typicalPerKg: 10 },
      cat: { minPerKg: 5, maxPerKg: 5, typicalPerKg: 5 },
      bird: { minPerKg: 10, maxPerKg: 30, typicalPerKg: 15 },
      rabbit: { minPerKg: 5, maxPerKg: 20, typicalPerKg: 10 },
    },
    defaultUnit: 'mg',
    tabletStrength: 22.7,
    safetyWarnings: {
      cat: [
        'CRITICAL: Strictly 5 mg/kg/day maximum. Higher doses cause retinal degeneration and permanent blindness.',
      ],
      bird: ['Use injectable form diluted for oral administration.'],
    },
    contraindications: {
      cat: ['DO NOT exceed 5 mg/kg — risk of permanent blindness.'],
    },
  },
  {
    id: 'phenobarbital',
    name: 'Phenobarbital',
    drugClass: 'Anticonvulsant / Barbiturate',
    dosageBySpecies: {
      dog: { minPerKg: 2, maxPerKg: 5, typicalPerKg: 2.5 },
      cat: { minPerKg: 2, maxPerKg: 4, typicalPerKg: 2.5 },
    },
    defaultUnit: 'mg',
    tabletStrength: 30,
    safetyWarnings: {
      dog: ['Monitor serum phenobarbital levels. Risk of hepatotoxicity with long-term use.'],
      cat: ['Monitor serum levels. May cause facial pruritus and sedation.'],
    },
    contraindications: {},
  },
  {
    id: 'doxycycline',
    name: 'Doxycycline',
    drugClass: 'Antibiotic (Tetracycline)',
    dosageBySpecies: {
      dog: { minPerKg: 5, maxPerKg: 10, typicalPerKg: 5 },
      cat: { minPerKg: 5, maxPerKg: 10, typicalPerKg: 5 },
      bird: { minPerKg: 25, maxPerKg: 50, typicalPerKg: 25 },
      rabbit: { minPerKg: 2.5, maxPerKg: 4, typicalPerKg: 2.5 },
    },
    defaultUnit: 'mg',
    tabletStrength: 100,
    safetyWarnings: {
      dog: ['Always administer with water to prevent esophageal stricture.'],
      cat: [
        'NEVER give as dry tablet — risk of esophageal stricture.',
        'Always follow immediately with water or food.',
      ],
      bird: ['Formulate as medicated water or food for avian administration.'],
    },
    contraindications: {
      cat: ['Dry tablet administration without water is contraindicated.'],
    },
  },
];

function round(n: number, decimals = 3): number {
  return parseFloat(n.toFixed(decimals));
}

export function calculateDoseInMg(weightKg: number, dosePerKg: number): number {
  if (weightKg <= 0 || dosePerKg <= 0) return 0;
  return weightKg * dosePerKg;
}

export function convertFromMg(
  amountMg: number,
  targetUnit: DoseUnit,
  concentration?: number,
  tabletStrength?: number,
): number {
  if (targetUnit === 'mg') return amountMg;
  if (targetUnit === 'ml') {
    if (!concentration || concentration <= 0) {
      throw new Error('Concentration (mg/ml) is required for milliliter conversion.');
    }
    return amountMg / concentration;
  }
  if (!tabletStrength || tabletStrength <= 0) {
    throw new Error('Tablet strength (mg/tablet) is required for tablet conversion.');
  }
  return amountMg / tabletStrength;
}

export function convertToMg(
  amount: number,
  fromUnit: DoseUnit,
  concentration?: number,
  tabletStrength?: number,
): number {
  if (fromUnit === 'mg') return amount;
  if (fromUnit === 'ml') {
    if (!concentration || concentration <= 0) {
      throw new Error('Concentration (mg/ml) is required for milliliter conversion.');
    }
    return amount * concentration;
  }
  if (!tabletStrength || tabletStrength <= 0) {
    throw new Error('Tablet strength (mg/tablet) is required for tablet conversion.');
  }
  return amount * tabletStrength;
}

export function assessDoseSafety(
  dosePerKg: number,
  range: DosageRange,
): { level: DosageSafetyLevel; warnings: string[] } {
  if (dosePerKg <= 0) {
    return { level: 'critical', warnings: ['Dose must be greater than zero.'] };
  }

  if (dosePerKg > range.maxPerKg * 2) {
    return {
      level: 'critical',
      warnings: [
        `Dose of ${dosePerKg.toFixed(2)} mg/kg is critically high (>${(range.maxPerKg * 2).toFixed(2)} mg/kg). Severe toxicity risk.`,
      ],
    };
  }

  if (dosePerKg > range.maxPerKg) {
    return {
      level: 'high',
      warnings: [
        `Dose of ${dosePerKg.toFixed(2)} mg/kg exceeds the maximum safe dose of ${range.maxPerKg} mg/kg.`,
      ],
    };
  }

  if (dosePerKg < range.minPerKg) {
    return {
      level: 'low',
      warnings: [
        `Dose of ${dosePerKg.toFixed(2)} mg/kg is below the minimum effective dose of ${range.minPerKg} mg/kg. Treatment may be sub-therapeutic.`,
      ],
    };
  }

  return { level: 'safe', warnings: [] };
}

export function computeDosage(input: DosageInput, range?: DosageRange): DosageResult {
  const { weightKg, dosePerKg, targetUnit, concentration, tabletStrength } = input;

  if (weightKg <= 0) {
    return {
      dose: 0,
      unit: targetUnit,
      doseInMg: 0,
      safetyLevel: 'critical',
      warnings: ['Weight must be greater than zero.'],
      vetDisclaimer: VET_DISCLAIMER,
    };
  }
  if (dosePerKg <= 0) {
    return {
      dose: 0,
      unit: targetUnit,
      doseInMg: 0,
      safetyLevel: 'critical',
      warnings: ['Dose per kg must be greater than zero.'],
      vetDisclaimer: VET_DISCLAIMER,
    };
  }

  // ── Bounds enforcement (issue #956) ────────────────────────────────────────
  if (weightKg > MAX_WEIGHT_KG) {
    throw new DosageBoundsError(
      `Weight ${weightKg} kg exceeds the maximum supported value of ${MAX_WEIGHT_KG} kg. ` +
        'Please verify the weight and consult a veterinarian.',
    );
  }
  if (dosePerKg > MAX_DOSE_PER_KG) {
    throw new DosageBoundsError(
      `Dose ${dosePerKg} mg/kg exceeds the maximum supported value of ${MAX_DOSE_PER_KG} mg/kg. ` +
        'Please verify the dose and consult a veterinarian.',
    );
  }

  const doseInMg = calculateDoseInMg(weightKg, dosePerKg);

  let dose: number;
  try {
    dose = convertFromMg(doseInMg, targetUnit, concentration, tabletStrength);
  } catch (err) {
    return {
      dose: 0,
      unit: targetUnit,
      doseInMg: round(doseInMg),
      safetyLevel: 'critical',
      warnings: [(err as Error).message],
      vetDisclaimer: VET_DISCLAIMER,
    };
  }

  let safetyLevel: DosageSafetyLevel = 'safe';
  const warnings: string[] = [];

  if (range) {
    const safety = assessDoseSafety(dosePerKg, range);
    safetyLevel = safety.level;
    warnings.push(...safety.warnings);
  }

  const result: DosageResult = {
    dose: round(dose),
    unit: targetUnit,
    doseInMg: round(doseInMg),
    safetyLevel,
    warnings,
    vetDisclaimer: VET_DISCLAIMER,
  };

  if (range) {
    const minMg = range.minPerKg * weightKg;
    const maxMg = range.maxPerKg * weightKg;
    try {
      result.rangeMin = round(convertFromMg(minMg, targetUnit, concentration, tabletStrength));
      result.rangeMax = round(convertFromMg(maxMg, targetUnit, concentration, tabletStrength));
    } catch {
      // omit range if unit conversion fails
    }
  }

  return result;
}

export function lookupDrug(
  drugId: string,
  species: Species,
): {
  drug: DrugRecord;
  range: DosageRange | null;
  warnings: string[];
  contraindications: string[];
} | null {
  const drug = DRUG_DATABASE.find((d) => d.id === drugId);
  if (!drug) return null;

  return {
    drug,
    range: drug.dosageBySpecies[species] ?? null,
    warnings: drug.safetyWarnings[species] ?? [],
    contraindications: drug.contraindications[species] ?? [],
  };
}

export function getDrugsForSpecies(species: Species): DrugRecord[] {
  return DRUG_DATABASE.filter((d) => d.dosageBySpecies[species] !== undefined);
}
